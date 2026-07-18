/**
 * useWebSocket.ts
 *
 * ACTUALIZADO — ahora sí entiende el formato real que manda server.cjs:
 *   { timestamp, channels: [ { index, name, samples: number[] }, ... ] }
 * donde `name` es uno de: 'Lead I','Lead II','V1'..'V6','Resp','PPG'
 * (Temperature todavía no se envía — confirmado por Axel, 2026-07-14).
 * Los `samples` vienen en cuentas RAW del ADC (24-bit), no en mV.
 *
 * Qué cambió vs la versión anterior:
 * 1. handlePacket ahora reconoce paquetes por NOMBRE de canal, no por posición.
 *    (Antes asumía channels[0..7] en un orden fijo que nunca coincidió con
 *    lo que manda el hardware real — por eso todo se quedaba en "--".)
 * 2. Conversión raw → mV con sign-extension de 24 bits, igual que el
 *    viewer.js de Axel (server.cjs no hace sign-extension — avisar a
 *    Axel/backend, es un posible bug ahí, pero no se toca desde aquí).
 * 3. "waveforms" ahora tiene 11 posiciones fijas y con nombre real:
 *      0 Lead I, 1 Lead II, 2 Lead III (derivado), 3 V1, 4 V2, 5 V3,
 *      6 V4, 7 V5, 8 V6, 9 Resp, 10 PPG
 *    Ya no hay hack de "% 4" — cada derivación jala su canal real.
 * 4. HR se calcula de Lead II (estándar clínico para detectar R-peaks,
 *    antes se usaba un canal genérico sin sentido clínico real).
 * 5. Temperatura y Presión Arterial YA NO se inventan con datos reales:
 *    el hardware no tiene esos sensores todavía, así que simplemente no
 *    se llama updateVitals para esos dos — se quedan en su valor default
 *    ("--" en la UI), que es el comportamiento correcto hoy.
 * 6. El simulador (sección SIMULATOR) se deja intacto por si se vuelve a
 *    usar — sigue mandando el formato viejo (arrays posicionales), y
 *    handlePacket todavía sabe leer ese formato como fallback, así que
 *    nada se rompe si alguien reactiva startSim().
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import useStore from '../store/useStore';
import type { EventType } from '../store/useStore';
import { auth } from '../lib/firebase';

// ─── Config ───────────────────────────────────────────────────────────────────

const WS_URL = `wss://chestpad-ws-server-1048900719191.us-central1.run.app/ws`;

// 1 hour @ 250Hz = 900,000 samples por canal
const BUFFER_SIZE = 900_000;

// ─── Esquema de canales reales (nombre → slot fijo en `waveforms`) ────────────
// Índices 0-8: derivaciones ECG. 9: Resp. 10: PPG.
// 'Lead III' no la manda el hardware — se deriva (Lead III = Lead II − Lead I).
const LEAD_NAMES = ['Lead I', 'Lead II', 'Lead III', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'] as const;
const RESP_SLOT = 9;
const PPG_SLOT = 10;
const TOTAL_SLOTS = 11;

// Nombre real del canal (tal cual lo manda server.cjs) → slot en `waveforms`.
// 'Lead III' se omite aquí a propósito: no llega por WS, se calcula aparte.
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

// Muestras visibles por slot (mismo criterio que antes: ECG necesita más
// resolución temporal que Resp/PPG, por eso decimamos estos últimos).
const VIEW_SIZES = [750, 750, 750, 750, 750, 750, 750, 750, 750, 150, 150];
const DECIMATE   = [1, 1, 1, 1, 1, 1, 1, 1, 1, 5, 5];

// Rangos min/max para WaveformCanvas, EN mV (ya convertido).
// TODO: son valores iniciales razonables para ECG de superficie (~±2mV) y
// Resp/PPG; ajustar con el device real conectado si el trazo se ve
// recortado (clipping) o plano.
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

// ─── Conversión raw ADC (24-bit) → mV ─────────────────────────────────────────
// Igual que viewer.js de Axel: sign-extension de 24 bits + escala a VREF.
// NOTA: server.cjs (el que sube a GCS) NO hace sign-extension todavía —
// solo filtra el valor "sensor no conectado". Avisar a Axel/backend, ya
// que eso puede estar corrompiendo valores negativos en los chunks de GCS.
const ADC_VREF_MV = 1200;
const ADC_MAX_VAL = 8388607; // 2^23 - 1

function rawToMv(rawValue: number): number {
  let v = rawValue;
  if (v > 0x7FFFFF) v -= 0x1000000; // sign-extend 24-bit two's complement
  if (v === ADC_MAX_VAL) return 0;  // sensor no conectado (pin flotante) → tratar como plano
  return (v / ADC_MAX_VAL) * ADC_VREF_MV;
}

// ─── Ring Buffer usando Float32Array ──────────────────────────────────────────

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
  // buf ya está en mV; el rango de swing esperado es mucho menor que en
  // cuentas raw. TODO: calibrar este umbral/escala con PPG real del device.
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
// Sin cambios de lógica — se deja intacto. Sigue mandando el formato viejo
// (channels: number[][], posicional). handlePacket abajo todavía sabe leer
// ese formato como fallback, por si se reactiva startSim().

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

  const [waveforms, setWaveforms] = useState<number[][]>(
    VIEW_SIZES.map(n => new Array(n).fill(0))
  );

  const rings  = useRef<RingBuffer[]>(Array.from({ length: TOTAL_SLOTS }, () => new RingBuffer(BUFFER_SIZE)));
  const wsRef  = useRef<WebSocket | null>(null);
  const simRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const simTime = useRef(0);

  // ── Procesa paquete entrante — soporta AMBOS formatos ───────────────────────
  const handlePacket = useCallback((packet: { timestamp: number; channels: unknown[] }) => {
    packet.channels.forEach((ch, i) => {
      // ── Formato REAL (server.cjs / device): { index, name, samples } ────────
      if (ch && typeof ch === 'object' && !Array.isArray(ch) && 'name' in (ch as any)) {
        const named = ch as { name: string; samples: number[] };
        const slot = CHANNEL_NAME_TO_SLOT[named.name];
        if (slot === undefined || !Array.isArray(named.samples)) return; // canal desconocido (p.ej. Temperature aún no llega)
        const ring = rings.current[slot];
        for (const raw of named.samples) ring.push(rawToMv(raw));
        return;
      }

      // ── Formato LEGACY (simulador): arrays posicionales, sin nombre ─────────
      if (Array.isArray(ch)) {
        // El simulador solo manda 8 slots [ch0-3 ECG, ch4 Resp, ch5 PPG, ch6 Temp, ch7 BP-fake].
        // Los mapeamos a un subconjunto razonable del nuevo esquema para que
        // el simulador se siga viendo bien si se reactiva.
        const legacyToSlot: Record<number, number> = { 0: 0, 1: 1, 2: 3, 3: 4, 4: RESP_SLOT, 5: PPG_SLOT };
        const slot = legacyToSlot[i];
        if (slot === undefined) return; // ch6 (temp) y ch7 (bp-fake) no tienen slot real — se ignoran aquí
        const ring = rings.current[slot];
        for (const v of ch) ring.push(v);
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

      // Lead III = Lead II − Lead I (ley de Einthoven) — no llega por WS, se deriva aquí.
      const leadI = next[0];
      const leadII = next[1];
      next[2] = leadII.map((v, i) => v - (leadI[i] ?? 0));

      setWaveforms(next);

      // Vitals cada ~1s
      vitalTick++;
      if (vitalTick < 30) return;
      vitalTick = 0;

      const leadIIRing = rings.current[1];  // Lead II: estándar clínico para detectar R-peaks
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

      // NOTA: Temperatura y Presión Arterial NO se actualizan aquí — el
      // hardware real todavía no tiene esos sensores (confirmado con Axel).
      // Se quedan en su valor default de la UI ("--") hasta que exista un
      // canal real que los respalde. Esto es intencional, no un olvido.
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
          // Audio de auscultación — se sigue guardando pero AuscultationPanel
          // todavía no está montado en App.tsx ni tiene lógica de reproducción.
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
        // startSim(); // SIMULATOR — descomentar solo si quieren fallback local sin device real
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
  }, [handlePacket, setConnected, setConnectionStatus, simulationMode]);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'set_mode', mode: simulationMode }));
    }
  }, [simulationMode]);

  return { waveforms };
};
