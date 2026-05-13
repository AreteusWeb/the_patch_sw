/**
 * useWebSocket.ts
 *
 * Cuando el dispositivo real esté listo:
 *   1. Borra la sección marcada "SIMULADOR"
 *   2. Cambia WS_URL al IP real del dispositivo
 *   3. Listo — el resto no cambia
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import useStore from '../store/useStore';
import type { EventType } from '../store/useStore';

// ─── Config ───────────────────────────────────────────────────────────────────

const WS_URL = 'ws://localhost:8080/ws';
const DEVICE_MAC = 'A1:B2:C3:D4:E5:F6';

// 1 hora @ 250Hz = 900,000 samples por canal
// Float32Array (4 bytes/sample) → ~28MB total para 8 canales
const BUFFER_SIZE = 900_000;

// Samples visibles por canal
// ECG @ 250Hz → 750 = 3s | Resp/PPG decimado 1:5 → 150 = 3s de onda lenta
const VIEW_SIZES = [750, 750, 750, 750, 150, 150, 50, 300];
const DECIMATE = [1, 1, 1, 1, 5, 5, 1, 1];

// Rangos min/max por canal para WaveformCanvas
export const CH_RANGES: [number, number][] = [
  [-2_500_000, 2_500_000],  // ch0-3 ECG (int32)
  [-2_500_000, 2_500_000],
  [-2_500_000, 2_500_000],
  [-2_500_000, 2_500_000],
  [-8_388_607, 8_388_607],  // ch4 Pneumography
  [0, 8_388_607],  // ch5 PPG
  [3_400_000, 4_200_000],  // ch6 Temp (34-42C x 100k)
  [-32_767, 32_767],  // ch7 Audio int16
];

// ─── Ring buffer con Float32Array ─────────────────────────────────────────────
// Pointer en lugar de splice -> cero GC, cero stutter con buffers grandes

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

  // Ultimos n samples en orden cronologico
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

    // Clamp offset so we don't go beyond the available history
    // This ensures we always return valid data (the oldest available) instead of zeros
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

// ─── Helpers vitales ──────────────────────────────────────────────────────────

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
  if (max - min < 100_000) return 98;
  return Math.min(100, Math.round((88 + ((max - min) / 8_388_607) * 25) * 10) / 10);
}

function extractTemp(buf: Float32Array): number {
  if (buf.length === 0) return 36.6;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i];
  return Math.round((sum / buf.length / 100_000) * 10) / 10;
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

function extractBp(buf: Float32Array): { sys: number, dia: number } | null {
  if (buf.length === 0) return null;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i];
  const avg = Math.round(sum / buf.length);
  if (avg < 1000) return null;
  return { sys: Math.floor(avg / 1000), dia: avg % 1000 };
}

// ─── SIMULADOR ────────────────────────────────────────────────────────────────
// Borrar esta sección cuando conectes el dispositivo real

type SimMode =
  | 'normal'
  | 'tachycardia' | 'bradycardia'
  | 'spo2_drop'
  | 'hyperthermia' | 'hypothermia'
  | 'tachypnea' | 'bradypnea'
  | 'hypertension' | 'hypotension';

// ── Eventos que el simulador dispara aleatoriamente ──────────────────────────
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
  normal: { hr: 75, resp: 16, temp: 36.6, spo2: 98, sys: 118, dia: 75 },
  tachycardia: { hr: 135, resp: 20, temp: 36.8, spo2: 96, sys: 132, dia: 84 },
  bradycardia: { hr: 40, resp: 14, temp: 36.5, spo2: 97, sys: 105, dia: 65 },
  spo2_drop: { hr: 82, resp: 24, temp: 36.6, spo2: 84, sys: 125, dia: 80 },
  hyperthermia: { hr: 98, resp: 21, temp: 39.4, spo2: 97, sys: 128, dia: 82 },
  hypothermia: { hr: 50, resp: 10, temp: 34.2, spo2: 95, sys: 100, dia: 62 },
  tachypnea: { hr: 90, resp: 28, temp: 37.1, spo2: 94, sys: 120, dia: 78 },
  bradypnea: { hr: 68, resp: 8, temp: 36.5, spo2: 96, sys: 115, dia: 74 },
  hypertension: { hr: 88, resp: 18, temp: 36.8, spo2: 97, sys: 155, dia: 98 },
  hypotension: { hr: 105, resp: 20, temp: 36.4, spo2: 96, sys: 82, dia: 52 },
};

const simState = { hr: 75, resp: 16, temp: 36.6, spo2: 98, sys: 118, dia: 75 };

function simEcg(t: number, hr: number): number {
  const phase = (t * hr / 60) % 1;
  let v = 0;
  if (phase < 0.04) v = 0.15 * Math.sin(phase / 0.04 * Math.PI);
  else if (phase < 0.10) v = -0.10 * Math.sin((phase - 0.04) / 0.06 * Math.PI);
  else if (phase < 0.18) v = 0.85 * Math.sin((phase - 0.10) / 0.08 * Math.PI);
  else if (phase < 0.22) v = -0.25 * Math.sin((phase - 0.18) / 0.04 * Math.PI);
  else if (phase < 0.38) v = 0.12 * Math.sin((phase - 0.22) / 0.16 * Math.PI);
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
  simState.hr += (p.hr - simState.hr) * 0.02 + (Math.random() - 0.5) * 0.5;
  simState.resp += (p.resp - simState.resp) * 0.02 + (Math.random() - 0.5) * 0.2;
  simState.temp += (p.temp - simState.temp) * 0.02 + (Math.random() - 0.5) * 0.02;
  simState.spo2 += (p.spo2 - simState.spo2) * 0.02 + (Math.random() - 0.5) * 0.2;
  simState.sys += (p.sys - simState.sys) * 0.02 + (Math.random() - 0.5) * 0.5;
  simState.dia += (p.dia - simState.dia) * 0.02 + (Math.random() - 0.5) * 0.5;
  simState.spo2 = Math.min(100, Math.max(0, simState.spo2));

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

// ─── FIN SIMULADOR ────────────────────────────────────────────────────────────

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useWebSocket = () => {
  const setConnected = useStore(s => s.setConnected);
  const setConnectionStatus = useStore(s => s.setConnectionStatus);
  const simulationMode = useStore(s => s.simulationMode);
  const updateVitals = useStore(s => s.updateVitals);
  const addAlert = useStore(s => s.addAlert);
  const addEvent = useStore(s => s.addEvent);
  const isLive = useStore(s => s.isLive);
  const historyOffset = useStore(s => s.historyOffset);

  const [waveforms, setWaveforms] = useState<number[][]>(
    VIEW_SIZES.map(n => new Array(n).fill(0))
  );

  const rings = useRef<RingBuffer[]>(Array.from({ length: 8 }, () => new RingBuffer(BUFFER_SIZE)));
  const wsRef = useRef<WebSocket | null>(null);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTime = useRef(0);

  // ── Procesar paquete ────────────────────────────────────────────────────────
  const handlePacket = useCallback((packet: { timestamp: number; channels: number[][] }) => {
    packet.channels.forEach((ch, i) => {
      if (i >= 8) return;
      const samples = Array.isArray(ch) ? ch : [ch];
      const ring = rings.current[i];
      for (const v of samples) ring.push(v);
    });
  }, []);

  // Ref para que el render loop siempre lea el historyOffset actual
  // sin necesidad de recrear el loop cada vez que cambia
  const historyOffsetRef = useRef(historyOffset);
  useEffect(() => { historyOffsetRef.current = historyOffset; }, [historyOffset]);

  const prevVitals = useRef({ hr: 0, spo2: 0, resp: 0, temp: 0, sys: 0 });

  const getTrend = useCallback((curr: number, prev: number, margin: number): 'up' | 'down' | 'stable' => {
    if (prev === 0) return 'stable';
    if (curr > prev + margin) return 'up';
    if (curr < prev - margin) return 'down';
    return 'stable';
  }, []);

  // ── Render loop + vitales @ 30fps ───────────────────────────────────────────
  useEffect(() => {
    let last = 0;
    let vitalTick = 0;
    let frameId: number;

    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;

      const offsetSamples = historyOffsetRef.current * 250; // segundos -> samples @ 250Hz

      // Waveforms
      const next = rings.current.map((ring, ch) => {
        const viewSize = VIEW_SIZES[ch];
        const dec = DECIMATE[ch];
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

      setWaveforms(next);

      // Vitales cada ~1s (30 frames a 30fps)
      vitalTick++;
      if (vitalTick < 30) return;
      vitalTick = 0;

      const ecg = offsetSamples === 0 ? rings.current[0].slice(750) : rings.current[0].sliceAt(750, offsetSamples);
      const ppg = offsetSamples === 0 ? rings.current[5].slice(250) : rings.current[5].sliceAt(250, offsetSamples);
      const resp = offsetSamples === 0 ? rings.current[4].slice(1500) : rings.current[4].sliceAt(1500, offsetSamples);
      const temp = offsetSamples === 0 ? rings.current[6].slice(25) : rings.current[6].sliceAt(25, offsetSamples);
      const bp = offsetSamples === 0 ? rings.current[7].slice(25) : rings.current[7].sliceAt(25, offsetSamples);

      const hr = estimateHR(ecg);
      const spo2 = estimateSpO2(ppg);
      const rr = estimateResp(resp);
      const tmp = extractTemp(temp);
      const bpData = extractBp(bp);

      const hrTrend = getTrend(hr, prevVitals.current.hr, 1);
      const spo2Trend = getTrend(spo2, prevVitals.current.spo2, 0.5);
      const rrTrend = getTrend(rr, prevVitals.current.resp, 1);
      const tmpTrend = getTrend(tmp, prevVitals.current.temp, 0.2);
      const sysTrend = bpData ? getTrend(bpData.sys, prevVitals.current.sys, 2) : 'stable';

      prevVitals.current = { hr, spo2, resp: rr, temp: tmp, sys: bpData ? bpData.sys : prevVitals.current.sys };

      if (hr > 0) updateVitals({
        heartRate: {
          value: hr,
          trend: hrTrend,
          severity: hr > 120 || hr < 45 ? 'critical' : hr > 100 || hr < 55 ? 'moderate' : 'normal',
        }
      });

      const updates: any = {
        spo2: { value: spo2, trend: spo2Trend, severity: spo2 < 90 ? 'critical' : spo2 < 94 ? 'moderate' : 'normal' },
        temperature: { value: tmp, trend: tmpTrend, severity: tmp > 39 ? 'critical' : tmp > 37.5 ? 'moderate' : 'normal' },
        respirationRate: { value: rr > 0 ? rr : 16, trend: rrTrend, severity: rr > 25 || rr < 10 ? 'critical' : 'normal' },
      };

      if (bpData) {
        updates.bloodPressure = {
          value: `${bpData.sys}/${bpData.dia}`,
          trend: sysTrend,
          severity: (bpData.sys > 140 || bpData.dia > 90) ? 'critical' : (bpData.sys < 90 || bpData.dia < 60) ? 'critical' : 'normal'
        };
      }

      updateVitals(updates);

      // Solo alertas en modo Live — no spamear con datos historicos
      if (historyOffset === 0) {
        if (hr > 120) addAlert({ timestamp: new Date().toLocaleTimeString(), message: `Elevated HR: ${hr} BPM`, severity: 'high' });
        if (hr > 0 && hr < 45) addAlert({ timestamp: new Date().toLocaleTimeString(), message: `Low HR: ${hr} BPM`, severity: 'high' });
        if (spo2 < 90) addAlert({ timestamp: new Date().toLocaleTimeString(), message: `SpO2 Drop: ${spo2}%`, severity: 'high' });
        if (tmp > 38.5) addAlert({ timestamp: new Date().toLocaleTimeString(), message: `Fever: ${tmp}C`, severity: 'medium' });
      }
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [updateVitals, addAlert]); // historyOffset se lee via ref, no recrea el loop

  // ── WebSocket + fallback simulador ─────────────────────────────────────────
  useEffect(() => {
    let reconnect: ReturnType<typeof setTimeout>;

    const stopSim = () => {
      if (simRef.current) { clearInterval(simRef.current); simRef.current = null; }
    };

    // SIMULADOR — borrar startSim() y su llamada en onclose cuando conectes el dispositivo real
    const startSim = () => {
      if (simRef.current) return;
      setConnected(true);
      setConnectionStatus('Stable');

      // Estado del evento activo del simulador
      let activeEvent: typeof SIM_EVENTS[0] | null = null;
      let ticksLeft = 0;
      let nextEventIn = 400 + Math.floor(Math.random() * 200); // primer evento ~40-60s
      let ticksSinceEvent = 0;

      simRef.current = setInterval(() => {
        simTime.current += 0.1;
        ticksSinceEvent++;

        // Gestión de eventos simulados
        if (activeEvent && ticksLeft > 0) {
          ticksLeft--;
          if (ticksLeft === 0) {
            activeEvent = null;
            nextEventIn = 800 + Math.floor(Math.random() * 800); // 80-160s entre eventos
            ticksSinceEvent = 0;
          }
        } else if (!activeEvent && ticksSinceEvent >= nextEventIn) {
          activeEvent = SIM_EVENTS[Math.floor(Math.random() * SIM_EVENTS.length)];
          ticksLeft = 300; // 30s de duración
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
    // FIN SIMULADOR

    const connect = () => {
      setConnectionStatus('Connecting');
      const ws = new WebSocket(WS_URL);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        stopSim();
        setConnected(true);
        setConnectionStatus('Stable');
        ws.send(JSON.stringify({ type: 'auth', mac: DEVICE_MAC }));
      };

      ws.onmessage = ({ data }) => {
        if (data instanceof ArrayBuffer) {
          // Binary: audio ch7 @ 8kHz, int16 LE, 800 samples = 1600 bytes
          const view = new DataView(data);
          const ring = rings.current[7];
          for (let i = 0; i < data.byteLength / 2; i++) ring.push(view.getInt16(i * 2, true));
        } else {
          try {
            const msg = JSON.parse(data as string);
            if (msg.channels) handlePacket(msg);
          } catch { /* auth_ok, mode_changed, etc */ }
        }
      };

      ws.onclose = () => {
        setConnected(false);
        setConnectionStatus('Disconnected');
        startSim(); // SIMULADOR — borrar esta linea cuando conectes el dispositivo real
        reconnect = setTimeout(connect, 5000);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      clearTimeout(reconnect);
      wsRef.current?.close();
      stopSim();
    };
  }, [handlePacket, setConnected, setConnectionStatus, simulationMode]);

  // ── Sync modo al servidor ──────────────────────────────────────────────────
  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_mode', mode: simulationMode }));
    }
  }, [simulationMode]);

  return { waveforms };
};
