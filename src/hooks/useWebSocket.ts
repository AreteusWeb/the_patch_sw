/**
 * useWebSocket.ts
 *
 * UPDATED — it now understands the real format sent by server.cjs:
 *   { timestamp, channels: [ { index, name, samples: number[] }, ... ] }
 * where `name` is one of: 'Lead I', 'Lead II', 'V1'..'V6', 'Resp', 'PPG'
 * (Temperature is still not sent — confirmed by Axel, 2026-07-14).
 * The `samples` arrive as raw ADC counts (24-bit), not mV.
 *
 * What changed compared to the previous version:
 * 1. handlePacket now recognizes packets by CHANNEL NAME instead of position.
 *    (Before, it assumed a fixed channels[0..7] order that never matched the
 *    format coming from the real hardware — which is why everything stayed at "--".)
 * 2. Raw → mV conversion uses 24-bit sign extension, matching Axel's viewer.js.
 *    (server.cjs does not do sign-extension yet — this should be reported to
 *    Axel/backend, since it may be corrupting negative values in GCS chunks.)
 * 3. "waveforms" now has 11 fixed positions with real names:
 *      0 Lead I, 1 Lead II, 2 Lead III (derived), 3 V1, 4 V2, 5 V3,
 *      6 V4, 7 V5, 8 V6, 9 Resp, 10 PPG
 *    The old "% 4" hack is gone — each derivation uses its real channel.
 * 4. HR is now calculated from Lead II (standard clinical choice for R-peak detection,
 *    whereas before it used a generic channel with no real clinical meaning).
 * 5. Temperature and Blood Pressure are NO LONGER invented from real data:
 *    the hardware does not have those sensors yet, so updateVitals is simply not
 *    called for them — they remain at their default UI value ("--"), which is the
 *    correct behavior today.
 * 6. The simulator (SIMULATOR section) is left intact in case it is used again —
 *    it still sends the legacy positional format, and handlePacket can still read
 *    that format as a fallback, so nothing breaks if startSim() is re-enabled.
 * 7. NEW: a 60Hz notch filter ported from Axel's viewer.js (biquad IIR, Q=20).
 *    It is toggled from the store (`notchFilterEnabled`, via the toggle in
 *    AdvancedControls.tsx) and applied uniformly across all 11 slots, matching
 *    the original implementation.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import useStore from '../store/useStore';
import type { EventType } from '../store/useStore';
import { auth } from '../lib/firebase';

// ─── Config ───────────────────────────────────────────────────────────────────

const WS_URL = `wss://chestpad-ws-server-1048900719191.us-central1.run.app/ws`;

// 1 hour @ 250Hz = 900,000 samples por canal
const BUFFER_SIZE = 900_000;

// ─── Real channel mapping (name → fixed slot in `waveforms`) ───────────────
// Indices 0-8: ECG derivations. 9: Resp. 10: PPG.
// 'Lead III' is not sent by the hardware — it is derived (Lead III = Lead II − Lead I).
const LEAD_NAMES = ['Lead I', 'Lead II', 'Lead III', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const;
const RESP_SLOT = 9;
const PPG_SLOT = 10;
const TOTAL_SLOTS = 11;

// Real channel name (as sent by server.cjs) → slot in `waveforms`.
// 'Lead III' is intentionally omitted here: it is not received over WS, so it is calculated separately.
const CHANNEL_NAME_TO_SLOT: Record<string, number> = {
  'Lead I': 0,
  'Lead II': 1,
  'V1': 3,
  'V2': 4,
  'V3': 5,
  'V4': 6,
  'V5': 7,
  'V6': 8,
  'Resp': RESP_SLOT,
  'PPG': PPG_SLOT,
};

// Visible samples per slot (same criterion as before: ECG needs more temporal
// resolution than Resp/PPG, so the latter are decimated).
const VIEW_SIZES = [750, 750, 750, 750, 750, 750, 750, 750, 750, 150, 150];
const DECIMATE   = [1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5];

// Min/max ranges for WaveformCanvas, in mV (already converted).
// TODO: these are reasonable initial values for surface ECG (~±2mV) and
// Resp/PPG; adjust them based on the real connected device if the trace looks
// clipped or flat.
export const CH_RANGES: [number, number][] = [
  [-2, 2],   // 0 Lead I
  [-2, 2],   // 1 Lead II
  [-2, 2],   // 2 Lead III (derivada)
  [-2, 2],   // 3 V1
  [-2, 2],   // 4 V2
  [-2, 2],   // 5 V3
  [-2, 2],   // 6 V4
  [-2, 2],   // 7 V5
  [-2, 2],   // 8 V6
  [-5, 5],   // 9 Resp
  [0, 5],    // 10 PPG
];

// ─── Raw ADC (24-bit) → mV conversion ─────────────────────────────────────
// Same as Axel's viewer.js: 24-bit sign extension + scaling to VREF.
// NOTE: server.cjs (the one that uploads to GCS) does NOT do sign-extension yet —
// it only filters the "sensor not connected" value. This should be reported to
// Axel/backend, since it may be corrupting negative values in GCS chunks.
const ADC_VREF_MV = 1200;
const ADC_MAX_VAL = 8388607; // 2^23 - 1

function rawToMv(rawValue: number): number {
  let v = rawValue;
  if (v > 0x7FFFFF) v -= 0x1000000; // sign-extend 24-bit two's complement
  if (v === ADC_MAX_VAL) return 0;  // sensor not connected (floating pin) → treat as flat
  return (v / ADC_MAX_VAL) * ADC_VREF_MV;
}

// ─── 60Hz Notch Filter (ported from Axel's viewer.js) ─────────────────────
// A classic IIR biquad used to remove the electrical line hum (60Hz in Mexico/US).
// It uses the same math as the original version — only translated to TS and
// exposed with reset() so it can be cleared when toggled.
const NOTCH_FREQ_HZ = 60;
const NOTCH_Q = 20;
const SAMPLING_RATE = 250; // Hz — coincide con el ADC del device (25 muestras/100ms)

class NotchFilter {
  private b0 = 0; private b1 = 0; private b2 = 0;
  private a1 = 0; private a2 = 0;
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private initialized = false;

  constructor(sampleRate: number, notchFreq: number, qFactor: number) {
    const w0 = 2.0 * Math.PI * notchFreq / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2.0 * qFactor);

    const b0 = 1.0, b1 = -2.0 * cosW0, b2 = 1.0;
    const a0 = 1.0 + alpha, a1 = -2.0 * cosW0, a2 = 1.0 - alpha;

    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  reset() {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.initialized = false;
  }

  process(x: number): number {
    if (!this.initialized) {
      this.x1 = this.x2 = this.y1 = this.y2 = x;
      this.initialized = true;
      return x;
    }
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2
             - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

// ─── Ring Buffer using Float32Array ────────────────────────────────────────

class RingBuffer {
  private buf: Float32Array;
  private ptr = 0;
  private _size = 0;

  constructor(private capacity: number) {
    this.buf = new Float32Array(capacity);
  }

  push(value: number) {
    this.buf[this.ptr] = value;
    this.ptr = (this.ptr + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
  }

  slice(n: number): Float32Array {
    const count = Math.min(n, this._size);
    const out = new Float32Array(count);
    const start = (this.ptr - count + this.capacity) % this.capacity;
    for (let i = 0; i < count; i++) {
      out[i] = this.buf[(start + i) % this.capacity];
    }
    return out;
  }

  sliceAt(n: number, offsetSamples: number): Float32Array {
    if (this._size === 0) return new Float32Array(n);
    const maxOffset = Math.max(0, this._size - n);
    const clampedOffset = Math.min(offsetSamples, maxOffset);
    const count = Math.min(n, this._size);
    const out = new Float32Array(count);
    const endPtr = (this.ptr - clampedOffset + this.capacity) % this.capacity;
    const start = (endPtr - count + this.capacity) % this.capacity;
    for (let i = 0; i < count; i++) {
      out[i] = this.buf[(start + i) % this.capacity];
    }
    return out;
  }

  get size() { return this._size; }
}

// ─── Vitals Estimation Helpers ────────────────────────────────────────────────

function estimateHR(buf: Float32Array): number {
  if (buf.length < 100) return 0;
  let max = -Infinity;
  for (let i = 0; i < buf.length; i++) if (buf[i] > max) max = buf[i];
  const threshold = max * 0.55;
  const peaks: number[] = [];
  for (let i = 1; i < buf.length - 1; i++) {
    if (buf[i] > threshold && buf[i] >= buf[i - 1] && buf[i] >= buf[i + 1]) {
      peaks.push(i);
      i += 40;
    }
  }
  if (peaks.length < 2) return 0;
  let totalDist = 0;
  for (let i = 1; i < peaks.length; i++) totalDist += (peaks[i] - peaks[i - 1]);
  return Math.round(15000 / (totalDist / (peaks.length - 1)));
}

function estimateSpO2(buf: Float32Array): number {
  if (buf.length < 10) return 98;
  let max = -Infinity, min = Infinity;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > max) max = buf[i];
    if (buf[i] < min) min = buf[i];
  }
  // buf is already in mV; the expected swing range is much smaller than raw counts.
  // TODO: calibrate this threshold/scale with the real PPG from the device.
  if (max - min < 0.02) return 98;
  return Math.min(100, Math.round((88 + ((max - min) / ADC_VREF_MV) * 2500) * 10) / 10);
}

function estimateResp(buf: Float32Array): number {
  if (buf.length < 200) return 16;
  const crossings: number[] = [];
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] < 0 && buf[i] >= 0) crossings.push(i);
  }
  if (crossings.length < 2) return 16;
  let totalDist = 0;
  for (let i = 1; i < crossings.length; i++) totalDist += (crossings[i] - crossings[i - 1]);
  return Math.round(15000 / (totalDist / (crossings.length - 1)));
}

// ─── SIMULATOR ────────────────────────────────────────────────────────────────
// No logic changes — it remains intact. It still sends the legacy format
// (channels: number[][], positional). handlePacket below can still read that
// format as a fallback in case startSim() is re-enabled.

type SimMode =
  | 'normal'
  | 'tachycardia' | 'bradycardia'
  | 'spo2_drop'
  | 'hyperthermia' | 'hypothermia'
  | 'tachypnea' | 'bradypnea'
  | 'hypertension' | 'hypotension';

const SIM_EVENTS: Array<{ mode: SimMode; type: EventType; label: string; severity: 'high' | 'medium' }> = [
  { mode: 'tachycardia', type: 'tachycardia', label: 'Elevated HR', severity: 'high' },
  { mode: 'bradycardia', type: 'bradycardia', label: 'Low HR', severity: 'high' },
  { mode: 'spo2_drop', type: 'spo2_drop', label: 'Low SpO2', severity: 'high' },
  { mode: 'hyperthermia', type: 'hyperthermia', label: 'High Temp', severity: 'medium' },
  { mode: 'hypothermia', type: 'hypothermia', label: 'Low Temp', severity: 'high' },
  { mode: 'tachypnea', type: 'tachypnea', label: 'High Resp Rate', severity: 'medium' },
  { mode: 'bradypnea', type: 'bradypnea', label: 'Low Resp Rate', severity: 'high' },
  { mode: 'hypertension', type: 'hypertension', label: 'High BP', severity: 'high' },
  { mode: 'hypotension', type: 'hypotension', label: 'Low BP', severity: 'high' },
];

const SIM_PARAMS: Record<SimMode, { hr: number; resp: number; temp: number; spo2: number; sys: number; dia: number }> = {
  normal:       { hr: 75,  resp: 16, temp: 36.6, spo2: 98, sys: 118, dia: 75 },
  tachycardia:  { hr: 135, resp: 20, temp: 36.8, spo2: 96, sys: 132, dia: 84 },
  bradycardia:  { hr: 40,  resp: 14, temp: 36.5, spo2: 97, sys: 105, dia: 65 },
  spo2_drop:    { hr: 82,  resp: 24, temp: 36.6, spo2: 84, sys: 125, dia: 80 },
  hyperthermia: { hr: 98,  resp: 21, temp: 39.4, spo2: 97, sys: 128, dia: 82 },
  hypothermia:  { hr: 50,  resp: 10, temp: 34.2, spo2: 95, sys: 100, dia: 62 },
  tachypnea:    { hr: 90,  resp: 28, temp: 37.1, spo2: 94, sys: 120, dia: 78 },
  bradypnea:    { hr: 68,  resp: 8,  temp: 36.5, spo2: 96, sys: 115, dia: 74 },
  hypertension: { hr: 88,  resp: 18, temp: 36.8, spo2: 97, sys: 155, dia: 98 },
  hypotension:  { hr: 105, resp: 20, temp: 36.4, spo2: 96, sys: 82,  dia: 52 },
};

const simState = { hr: 75, resp: 16, temp: 36.6, spo2: 98, sys: 118, dia: 75 };

function simEcg(t: number, hr: number): number {
  const phase = (t * hr / 60) % 1;
  let v = 0;
  if (phase < 0.04)       v = 0.15 * Math.sin(phase / 0.04 * Math.PI);
  else if (phase < 0.10)  v = -0.10 * Math.sin((phase - 0.04) / 0.06 * Math.PI);
  else if (phase < 0.18)  v = 0.85 * Math.sin((phase - 0.10) / 0.08 * Math.PI);
  else if (phase < 0.22)  v = -0.25 * Math.sin((phase - 0.18) / 0.04 * Math.PI);
  else if (phase < 0.38)  v = 0.12 * Math.sin((phase - 0.22) / 0.16 * Math.PI);
  return Math.round((v + (Math.random() - 0.5) * 0.015) * 2_000_000);
}

function simPpg(t: number, hr: number, spo2: number): number {
  const phase = (t * hr / 60) % 1;
  const amplitude = Math.max(0.01, (spo2 - 88) / 25);
  return Math.round((Math.pow(Math.sin(phase * Math.PI), 2) * amplitude + Math.random() * 0.01) * 8_000_000);
}

function simResp(t: number, resp: number): number {
  return Math.round(Math.sin(t * 2 * Math.PI * resp / 60) * 7_000_000);
}

function buildSimPacket(t: number, mode: SimMode) {
  const p = SIM_PARAMS[mode];
  simState.hr   += (p.hr   - simState.hr)   * 0.02 + (Math.random() - 0.5) * 0.5;
  simState.resp += (p.resp - simState.resp) * 0.02 + (Math.random() - 0.5) * 0.2;
  simState.temp += (p.temp - simState.temp) * 0.02 + (Math.random() - 0.5) * 0.02;
  simState.spo2 += (p.spo2 - simState.spo2) * 0.02 + (Math.random() - 0.5) * 0.2;
  simState.sys  += (p.sys  - simState.sys)  * 0.02 + (Math.random() - 0.5) * 0.5;
  simState.dia  += (p.dia  - simState.dia)  * 0.02 + (Math.random() - 0.5) * 0.5;
  simState.spo2  = Math.min(100, Math.max(0, simState.spo2));

  const dt = 1 / 250;
  const channels: number[][] = Array.from({ length: 8 }, () => []);
  for (let s = 0; s < 25; s++) {
    const ts = t + s * dt;
    channels[0].push(simEcg(ts, simState.hr));
    channels[1].push(Math.round(simEcg(ts, simState.hr) * 0.85));
    channels[2].push(Math.round(simEcg(ts, simState.hr) * 0.65));
    channels[3].push(Math.round(simEcg(ts, simState.hr) * -0.5));
    channels[4].push(simResp(ts, simState.resp));
    channels[5].push(simPpg(ts, simState.hr, simState.spo2));
    channels[6].push(Math.round(simState.temp * 100_000 + (Math.random() - 0.5) * 500));
    channels[7].push(Math.round(simState.sys * 1000 + simState.dia));
  }
  return { timestamp: Math.round(t * 1000), channels };
}

// ─── END SIMULATOR ────────────────────────────────────────────────────────────

// ─── WebSocket Hook ───────────────────────────────────────────────────────────

export const useWebSocket = () => {
  const setConnected        = useStore(s => s.setConnected);
  const setConnectionStatus = useStore(s => s.setConnectionStatus);
  const simulationMode      = useStore(s => s.simulationMode);
  const updateVitals        = useStore(s => s.updateVitals);
  const addAlert            = useStore(s => s.addAlert);
  const addEvent            = useStore(s => s.addEvent);
  const historyOffset       = useStore(s => s.historyOffset);
  const deviceMac           = useStore(s => s.deviceMac);
  const notchFilterEnabled  = useStore(s => s.notchFilterEnabled);

  const [waveforms, setWaveforms] = useState<number[][]>(
    VIEW_SIZES.map(n => new Array(n).fill(0))
  );

  const rings  = useRef<RingBuffer[]>(Array.from({ length: TOTAL_SLOTS }, () => new RingBuffer(BUFFER_SIZE)));
  const wsRef  = useRef<WebSocket | null>(null);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTime = useRef(0);

  // One filter per slot (11 total) — same approach as Axel: it is applied
  // uniformly to all channels, not only ECG ones.
  const notchFilters = useRef<NotchFilter[]>(
    Array.from({ length: TOTAL_SLOTS }, () => new NotchFilter(SAMPLING_RATE, NOTCH_FREQ_HZ, NOTCH_Q))
  );

  // When the filter is turned on/off, the internal biquad state is reset
  // (same idea as Axel's resetNotchFilters()) so it does not carry over memory
  // from before the toggle. A small jump in the trace may be visible at the
  // instant of switching — that is normal for IIR filters and settles in <1s.
  useEffect(() => {
    notchFilters.current.forEach(f => f.reset());
  }, [notchFilterEnabled]);

  // ── Process incoming packets — supports BOTH formats ─────────────────────
  const handlePacket = useCallback((packet: { timestamp: number; channels: unknown[] }) => {
    // Read on each call (instead of making it a dependency of useCallback) so
    // handlePacket does not need to be recreated, and therefore the WS listener
    // does not need to be rebuilt whenever the filter is toggled.
    const notchOn = useStore.getState().notchFilterEnabled;

    packet.channels.forEach((ch, i) => {
      // ── Real format (server.cjs / device): { index, name, samples } ────────
      if (ch && typeof ch === 'object' && !Array.isArray(ch) && 'name' in (ch as any)) {
        const named = ch as { name: string; samples: number[] };
        const slot = CHANNEL_NAME_TO_SLOT[named.name];
        if (slot === undefined || !Array.isArray(named.samples)) return; // unknown channel (e.g. Temperature is not received yet)
        const ring = rings.current[slot];
        const filter = notchFilters.current[slot];
        for (const raw of named.samples) {
          const mv = rawToMv(raw);
          ring.push(notchOn ? filter.process(mv) : mv);
        }
        return;
      }

      // ── Legacy format (simulator): positional arrays, no names ─────────────
      if (Array.isArray(ch)) {
        // The simulator only sends 8 slots [ch0-3 ECG, ch4 Resp, ch5 PPG, ch6 Temp, ch7 BP-fake].
        // We map them to a reasonable subset of the new scheme so the simulator
        // still looks good if it is re-enabled.
        const legacyToSlot: Record<number, number> = { 0: 0, 1: 1, 2: 3, 3: 4, 4: RESP_SLOT, 5: PPG_SLOT };
        const slot = legacyToSlot[i];
        //console.log('[DEBUG simulador] canal índice', i, '→ slot', slot); // ← temporal
        if (slot === undefined) return; // ch6 (temp) and ch7 (bp-fake) have no real slot — they are ignored here
        const ring = rings.current[slot];
        const filter = notchFilters.current[slot];
        for (const v of ch) ring.push(notchOn ? filter.process(v) : v);
      }
    });
  }, []);

  const historyOffsetRef = useRef(historyOffset);
  useEffect(() => { historyOffsetRef.current = historyOffset; }, [historyOffset]);

  const prevVitals = useRef({ hr: 0, spo2: 0, resp: 0 });

  const getTrend = useCallback((curr: number, prev: number, margin: number): 'up' | 'down' | 'stable' => {
    if (prev === 0) return 'stable';
    if (curr > prev + margin) return 'up';
    if (curr < prev - margin) return 'down';
    return 'stable';
  }, []);

  // ── Render Loop + Vitals Estimation @ 30fps ─────────────────────────────────
  useEffect(() => {
    let last = 0;
    let vitalTick = 0;
    let frameId: number;

    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;

      const offsetSamples = historyOffsetRef.current * 250;

      // Waveforms (0-8 leads, 9 Resp, 10 PPG)
      const next = rings.current.map((ring, slot) => {
        const viewSize = VIEW_SIZES[slot];
        const dec = DECIMATE[slot];
        const rawNeed = viewSize * dec;

        const raw = offsetSamples === 0
          ? ring.slice(rawNeed)
          : ring.sliceAt(rawNeed, offsetSamples);

        if (dec === 1) return Array.from(raw).slice(-viewSize);

        const out: number[] = [];
        for (let i = 0; i + dec <= raw.length; i += dec) {
          let sum = 0;
          for (let j = 0; j < dec; j++) sum += raw[i + j];
          out.push(sum / dec);
        }
        return out.slice(-viewSize);
      });

      // Lead III = Lead II − Lead I (Einthoven's law) — it does not arrive over WS, so it is derived here.
      const leadI = next[0];
      const leadII = next[1];
      next[2] = leadII.map((v, i) => v - (leadI[i] ?? 0));

      setWaveforms(next);

      // Vitals cada ~1s
      vitalTick++;
      if (vitalTick < 30) return;
      vitalTick = 0;

      const leadIIRing = rings.current[1];  // Lead II: standard clinical choice for detecting R-peaks
      const respRing   = rings.current[RESP_SLOT];
      const ppgRing    = rings.current[PPG_SLOT];

      const ecg  = offsetSamples === 0 ? leadIIRing.slice(750)  : leadIIRing.sliceAt(750, offsetSamples);
      const ppg  = offsetSamples === 0 ? ppgRing.slice(250)     : ppgRing.sliceAt(250, offsetSamples);
      const resp = offsetSamples === 0 ? respRing.slice(1500)   : respRing.sliceAt(1500, offsetSamples);

      const hr   = estimateHR(ecg);
      const spo2 = estimateSpO2(ppg);
      const rr   = estimateResp(resp);

      const hrTrend   = getTrend(hr, prevVitals.current.hr, 1);
      const spo2Trend = getTrend(spo2, prevVitals.current.spo2, 0.5);
      const rrTrend   = getTrend(rr, prevVitals.current.resp, 1);

      prevVitals.current = { hr, spo2, resp: rr };

      if (hr > 0) {
        updateVitals({
          heartRate: {
            value: hr,
            trend: hrTrend,
            severity: hr > 120 || hr < 45 ? 'critical' : hr > 100 || hr < 55 ? 'moderate' : 'normal',
          }
        });

        if (!useStore.getState().hasRealData) {
          useStore.getState().setHasRealData(true);
        }
      }

      // NOTE: Temperature and Blood Pressure are NOT updated here — the real
      // hardware does not have those sensors yet (confirmed by Axel).
      // They remain at their default UI value ("--") until a real channel exists
      // to support them. This is intentional, not an oversight.
      updateVitals({
        spo2: {
          value: spo2,
          trend: spo2Trend,
          severity: spo2 < 90 ? 'critical' : spo2 < 94 ? 'moderate' : 'normal',
        },
        respirationRate: {
          value: rr > 0 ? rr : 16,
          trend: rrTrend,
          severity: rr > 25 || rr < 10 ? 'critical' : 'normal',
        },
      });

      if (historyOffsetRef.current === 0) {
        if (hr > 120)          addAlert({ timestamp: new Date().toLocaleTimeString(), message: `Elevated HR: ${hr} BPM`, severity: 'high' });
        if (hr > 0 && hr < 45) addAlert({ timestamp: new Date().toLocaleTimeString(), message: `Low HR: ${hr} BPM`, severity: 'high' });
        if (spo2 < 90)         addAlert({ timestamp: new Date().toLocaleTimeString(), message: `SpO2 Drop: ${spo2}%`, severity: 'high' });
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [updateVitals, addAlert]);

  // ── WebSocket + Simulator Fallback ─────────────────────────────────────────
  useEffect(() => {
    let reconnect: ReturnType<typeof setTimeout>;

    const stopSim = () => {
      if (simRef.current) { clearInterval(simRef.current); simRef.current = null; }
    };

    const startSim = () => {
      if (simRef.current) return;
      setConnected(true);
      setConnectionStatus('Stable');

      let activeEvent: typeof SIM_EVENTS[0] | null = null;
      let ticksLeft = 0;
      let nextEventIn = 400 + Math.floor(Math.random() * 200);
      let ticksSinceEvent = 0;

      simRef.current = setInterval(() => {
        simTime.current += 0.1;
        ticksSinceEvent++;

        if (activeEvent && ticksLeft > 0) {
          ticksLeft--;
          if (ticksLeft === 0) {
            activeEvent = null;
            nextEventIn = 800 + Math.floor(Math.random() * 800);
            ticksSinceEvent = 0;
          }
        } else if (!activeEvent && ticksSinceEvent >= nextEventIn) {
          activeEvent = SIM_EVENTS[Math.floor(Math.random() * SIM_EVENTS.length)];
          ticksLeft = 300;
          ticksSinceEvent = 0;
          addEvent({
            type: activeEvent.type,
            label: activeEvent.label,
            severity: activeEvent.severity,
            timestampEpoch: Date.now(),
          });
        }

        const currentMode = activeEvent ? activeEvent.mode : (simulationMode as SimMode);
        handlePacket(buildSimPacket(simTime.current, currentMode));
      }, 100);
    };

    const connect = () => {
      setConnectionStatus('Connecting');
      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = async () => {
        stopSim();
        setConnectionStatus('Connecting');

        const user = await new Promise<import('firebase/auth').User | null>((resolve) => {
          if (auth.currentUser) { resolve(auth.currentUser); return; }
          const unsub = auth.onAuthStateChanged((u) => { unsub(); resolve(u); });
        });

        if (!user) {
          console.warn('[WS] onopen: no authenticated user, closing');
          ws.close();
          return;
        }

        try {
          const token = await user.getIdToken(true);
          ws.send(JSON.stringify({ type: 'auth', token, deviceMac: deviceMac ?? '' }));
        } catch (err) {
          console.error('[WS] Failed to get ID token:', err);
          ws.close();
        }
      };

      ws.onmessage = ({ data }) => {
        if (data instanceof ArrayBuffer) {
          // Auscultation audio — it is still stored, but the AuscultationPanel
          // is not mounted in App.tsx yet and has no playback logic.
          return;
        }
        try {
          const msg = JSON.parse(data as string);
          if (msg.channels) handlePacket(msg);

          if (msg.type === 'auth_ok') {
            setConnected(true);
            setConnectionStatus('Stable');
          }

          if (msg.type === 'device_disconnected') {
            setConnected(false);
            setConnectionStatus('Disconnected');
          }
        } catch { /* ignore non-JSON messages */ }
      };

      ws.onclose = () => {
        setConnected(false);
        setConnectionStatus('Disconnected');
        // startSim(); // SIMULATOR — uncomment only if you want a local fallback without a real device
        reconnect = setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    };

    connect(); // ← comenta para probar con simulador sin device real
    //startSim();   // ← TEMPORAL: fuerza el simulador

    return () => {
      clearTimeout(reconnect);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      stopSim();
    };
  }, [handlePacket, setConnected, setConnectionStatus, simulationMode]);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_mode', mode: simulationMode }));
    }
  }, [simulationMode]);

  return { waveforms };
};
