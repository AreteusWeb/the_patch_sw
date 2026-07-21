/**
 * useWebSocket.ts
 *
 * Understands the real format sent by server.cjs:
 *   { timestamp, channels: [ { index, name, samples: number[] }, ... ] }
 * where `name` is one of: 'Lead I', 'Lead II', 'V1'..'V6', 'Resp', 'PPG'
 * (Temperature is not sent yet — confirmed by Axel, 2026-07-14. A slot is
 * reserved for it below so nothing needs to be reshuffled once it arrives.)
 * `samples` arrive as raw ADC counts (24-bit), not mV.
 *
 * CHANGE (2026-07-20): 'Lead III' removed entirely, per decision — the
 * hardware never sends it, and it was previously being derived on the
 * client (Lead III = Lead II − Lead I) even though nobody asked for a
 * derived/synthetic lead. Removing it means every downstream slot index
 * shifts down by one compared to the previous version of this file.
 *
 * ─── Slot layout (10 real + 1 reserved) ─────────────────────────────────
 *   0 Lead I    1 Lead II   2 V1   3 V2   4 V3   5 V4   6 V5   7 V6
 *   8 Resp      9 PPG       10 Temp (RESERVED — device does not send this
 *                                    yet; slot stays at 0 until it does)
 *
 * What else this version does, same as before:
 * - handlePacket recognizes packets by CHANNEL NAME instead of position.
 * - Raw → mV conversion uses 24-bit sign extension, matching Axel's viewer.js.
 *   (server.cjs does not sign-extend yet — worth reporting to Axel/backend,
 *   since it may be corrupting negative values in GCS chunks.)
 * - HR is calculated from Lead II (standard clinical choice for R-peak detection).
 * - Temperature and Blood Pressure are NOT invented from real data: the
 *   hardware doesn't have those sensors (BP never will; Temp is pending).
 *   updateVitals is simply never called for them here.
 *   NOTE: the zustand store's default vitals (temperature: 36.5, bloodPressure:
 *   '118/75') still need to be changed to '--' separately in useStore.ts —
 *   this file not calling updateVitals for them does NOT make the UI show
 *   '--', it just means the store's hardcoded default stays displayed forever.
 *   Flag this to whoever owns useStore.ts.
 * - The simulator (SIMULATOR section) is left intact. It still sends the
 *   legacy positional format; handlePacket reads it as a fallback so nothing
 *   breaks if startSim() is re-enabled. Its fake Temp channel (old index 6)
 *   is now routed into the reserved Temp slot, purely so you can visually
 *   test that slot's wiring before the real sensor exists — it is NOT real
 *   data and should not be mistaken for it.
 * - 60Hz notch filter (biquad IIR, Q=20), toggled via store's
 *   `notchFilterEnabled`. NOTE: this field was not present in the useStore.ts
 *   you shared earlier — confirm it's been added, otherwise the toggle is a
 *   no-op (filter simply never activates, doesn't crash).
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import useStore from '../store/useStore';
import type { EventType } from '../store/useStore';
import { auth } from '../lib/firebase';

// ─── Config ───────────────────────────────────────────────────────────────────

const WS_URL = `wss://chestpad-ws-server-1048900719191.us-central1.run.app/ws`;

// 1 hour @ 250Hz = 900,000 samples per channel
const BUFFER_SIZE = 900_000;

// ─── Real channel mapping (name → fixed slot in `waveforms`) ───────────────

// CHANGE: exported so WaveformContainer.tsx (and anything else that needs
// the lead list / dropdown) reads from a single source of truth instead of
// hardcoding its own array that can drift out of sync with this file.
export const LEADS = ['Lead I', 'Lead II', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const;

const RESP_SLOT = 8;
const PPG_SLOT = 9;
const TEMP_SLOT = 10; // RESERVED — no real data yet, see file header
const TOTAL_SLOTS = 11;

// CHANGE: exported name → slot map for the 8 ECG leads specifically (what
// the dropdown needs). Kept separate from CHANNEL_NAME_TO_SLOT below
// (which also includes Resp/PPG/Temp) so consumers that only care about
// leads don't have to filter out non-ECG entries themselves.
export const LEAD_CHANNEL_INDEX: Record<string, number> = {
  'Lead I': 0,
  'Lead II': 1,
  'V1': 2,
  'V2': 3,
  'V3': 4,
  'V4': 5,
  'V5': 6,
  'V6': 7,
};

// Real channel name (as sent by server.cjs) → slot in `waveforms`.
const CHANNEL_NAME_TO_SLOT: Record<string, number> = {
  ...LEAD_CHANNEL_INDEX,
  'Resp': RESP_SLOT,
  'PPG': PPG_SLOT,
  'Temp': TEMP_SLOT, // reserved — see file header. Safe to keep here even
                      // though the device never sends it yet: handlePacket
                      // only pushes samples when a channel with this name
                      // actually arrives, so this slot just stays at 0
                      // until Axel wires up the real sensor.
};

// Visible samples per slot (indices 0-10, matching the layout above)
const VIEW_SIZES = [750, 750, 750, 750, 750, 750, 750, 750, 150, 150, 150];
const DECIMATE   = [1, 1, 1, 1, 1, 1, 1, 1, 5, 5, 1];

// Min/max ranges for WaveformCanvas, in mV (already converted).
// TODO: these are reasonable initial values for surface ECG (~±2mV) and
// Resp/PPG; adjust based on the real connected device if a trace looks
// clipped or flat. Temp range is a placeholder (°C) — revisit once the
// real channel's units/scale are confirmed with Axel.
export const CH_RANGES: [number, number][] = [
  [-2, 2],   // 0 Lead I
  [-2, 2],   // 1 Lead II
  [-2, 2],   // 2 V1
  [-2, 2],   // 3 V2
  [-2, 2],   // 4 V3
  [-2, 2],   // 5 V4
  [-2, 2],   // 6 V5
  [-2, 2],   // 7 V6
  [-5, 5],   // 8 Resp
  [0, 5],    // 9 PPG
  [30, 42],  // 10 Temp (RESERVED — placeholder range, unused until real data arrives)
];

// ─── Raw ADC (24-bit) → mV conversion ─────────────────────────────────────
const ADC_VREF_MV = 1200;
const ADC_MAX_VAL = 8388607; // 2^23 - 1

function rawToMv(rawValue: number): number {
  let v = rawValue;
  if (v > 0x7FFFFF) v -= 0x1000000; // sign-extend 24-bit two's complement
  if (v === ADC_MAX_VAL) return 0;  // sensor not connected (floating pin) → treat as flat
  return (v / ADC_MAX_VAL) * ADC_VREF_MV;
}

// ─── 60Hz Notch Filter (ported from Axel's viewer.js) ─────────────────────
const NOTCH_FREQ_HZ = 60;
const NOTCH_Q = 20;
const SAMPLING_RATE = 250; // Hz — matches the device's ADC (25 samples/100ms)

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
// Left intact — still sends the legacy positional format (channels: number[][]).
// handlePacket below still reads that format as a fallback in case startSim()
// is re-enabled.

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
  // OLD 8-channel positional format (unchanged): 0-3 ecg variants,
  // 4 resp, 5 ppg, 6 temp (fake), 7 bp (fake).
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

  const notchFilters = useRef<NotchFilter[]>(
    Array.from({ length: TOTAL_SLOTS }, () => new NotchFilter(SAMPLING_RATE, NOTCH_FREQ_HZ, NOTCH_Q))
  );

  useEffect(() => {
    notchFilters.current.forEach(f => f.reset());
  }, [notchFilterEnabled]);

  // ── Process incoming packets — supports BOTH formats ─────────────────────
  const handlePacket = useCallback((packet: { timestamp: number; channels: unknown[] }) => {
    const notchOn = useStore.getState().notchFilterEnabled;

    packet.channels.forEach((ch, i) => {
      // ── Real format (server.cjs / device): { index, name, samples } ────────
      if (ch && typeof ch === 'object' && !Array.isArray(ch) && 'name' in (ch as any)) {
        const named = ch as { name: string; samples: number[] };
        const slot = CHANNEL_NAME_TO_SLOT[named.name];
        if (slot === undefined || !Array.isArray(named.samples)) return; // unknown/unsent channel
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
        // CHANGE: renumbered to match the new 11-slot layout (no Lead III).
        // ch6 (the simulator's fake temp channel) is routed into the
        // reserved Temp slot purely so you can visually confirm that slot's
        // wiring works before the real sensor exists — it is NOT real data.
        const legacyToSlot: Record<number, number> = {
          0: 0,           // Lead I
          1: 1,           // Lead II
          2: 2,           // V1
          3: 3,           // V2
          4: RESP_SLOT,
          5: PPG_SLOT,
          6: TEMP_SLOT,   // simulator's fake temp → reserved Temp slot (test-only)
        };
        const slot = legacyToSlot[i];
        if (slot === undefined) return; // ch7 (fake bp) has no real slot — ignored
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

      // Waveforms (0-7 leads, 8 Resp, 9 PPG, 10 Temp-reserved)
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

      // CHANGE: Lead III derivation removed entirely — per decision, we no
      // longer synthesize a lead the device doesn't send.

      setWaveforms(next);

      // Vitals every ~1s
      vitalTick++;
      if (vitalTick < 30) return;
      vitalTick = 0;

      const leadIIRing = rings.current[LEAD_CHANNEL_INDEX['Lead II']]; // clinical standard for R-peaks
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
      // hardware doesn't have those sensors yet (Temp pending, BP never
      // will). They stay at whatever useStore.ts's default is — which
      // currently is NOT '--' (see file header). Fix that in useStore.ts.
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
          // Auscultation audio — stored elsewhere if/when a panel needs it.
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
        // startSim(); // SIMULATOR — uncomment only for a local fallback without a real device
        reconnect = setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
      };
    };

    connect();

    return () => {
      clearTimeout(reconnect);
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close();
      }
      stopSim();
    };
  }, [handlePacket, setConnected, setConnectionStatus, simulationMode, deviceMac]);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_mode', mode: simulationMode }));
    }
  }, [simulationMode]);

  return { waveforms };
};
