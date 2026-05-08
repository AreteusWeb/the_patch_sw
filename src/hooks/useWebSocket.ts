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
import type { ChestEvent, EventType } from '../store/useStore';

// ─── Config ───────────────────────────────────────────────────────────────────

const WS_URL     = 'ws://localhost:8080/ws';
const DEVICE_MAC = 'A1:B2:C3:D4:E5:F6';

// 1 hora @ 250Hz = 900,000 samples por canal
// Float32Array (4 bytes/sample) → ~28MB total para 8 canales
const BUFFER_SIZE = 900_000;

// Samples visibles por canal
// ECG @ 250Hz → 750 = 3s | Resp/PPG decimado 1:5 → 150 = 3s de onda lenta
const VIEW_SIZES = [750, 750, 750, 750, 150, 150, 50, 300];
const DECIMATE   = [1,   1,   1,   1,   5,   5,   1,  1  ];

// Rangos min/max por canal para WaveformCanvas
export const CH_RANGES: [number, number][] = [
  [-2_500_000, 2_500_000],  // ch0-3 ECG (int32)
  [-2_500_000, 2_500_000],
  [-2_500_000, 2_500_000],
  [-2_500_000, 2_500_000],
  [-8_388_607, 8_388_607],  // ch4 Pneumography
  [0,          8_388_607],  // ch5 PPG
  [3_400_000,  4_200_000],  // ch6 Temp (34-42C x 100k)
  [-32_767,    32_767   ],  // ch7 Audio int16
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
    const out   = new Float32Array(count);
    const start = (this.ptr - count + this.capacity) % this.capacity;
    for (let i = 0; i < count; i++) {
      out[i] = this.buf[(start + i) % this.capacity];
    }
    return out;
  }

  // n samples terminando offsetSamples antes del final (modo historico)
  sliceAt(n: number, offsetSamples: number): Float32Array {
    // Si el offset pide mas de lo que hay en el buffer, devolver zeros
    if (offsetSamples >= this._size) return new Float32Array(n);
    const available = this._size - offsetSamples;
    const count = Math.min(n, available);
    const out   = new Float32Array(count);
    // ptr apunta al proximo slot a escribir
    // retrocedemos offsetSamples desde ahi para llegar al "fin" de la ventana
    const endPtr = (this.ptr - offsetSamples + this.capacity) % this.capacity;
    const start  = (endPtr - count + this.capacity) % this.capacity;
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
  let peaks = 0;
  for (let i = 1; i < buf.length - 1; i++) {
    if (buf[i] > threshold && buf[i] >= buf[i-1] && buf[i] >= buf[i+1]) {
      peaks++;
      i += 10;
    }
  }
  return Math.round(peaks * 20); // 750 samples @ 250Hz = 3s -> peaks * 20 = BPM
}

function estimateSpO2(buf: Float32Array): number {
  if (buf.length < 10) return 98;
  let max = -Infinity, min = Infinity;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] > max) max = buf[i];
    if (buf[i] < min) min = buf[i];
  }
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
  let crossings = 0;
  for (let i = 1; i < buf.length; i++) {
    if ((buf[i-1] < 0) !== (buf[i] < 0)) crossings++;
  }
  return Math.round((crossings / 2) * (60 / (buf.length / 250)));
}

// ─── SIMULADOR ───────────────────────────────────────────────────────────────
// Borrar esta sección cuando conectes el dispositivo real

type SimMode = 'normal' | 'tachycardia' | 'bradycardia' | 'spo2drop' | 'fever';

// Targets base por modo
const SIM_TARGETS: Record<SimMode, { hr: number; resp: number; temp: number; sys: number; dia: number }> = {
  normal:      { hr: 72,  resp: 14, temp: 36.5, sys: 118, dia: 75 },
  tachycardia: { hr: 130, resp: 22, temp: 37.0, sys: 135, dia: 85 },
  bradycardia: { hr: 44,  resp: 12, temp: 36.4, sys: 105, dia: 65 },
  spo2drop:    { hr: 88,  resp: 24, temp: 36.6, sys: 122, dia: 78 },
  fever:       { hr: 98,  resp: 21, temp: 39.4, sys: 128, dia: 82 },
};

// Estado vivo del simulador - deriva lentamente hacia el target
const simState = {
  hr: 72, resp: 14, temp: 36.5, sys: 118, dia: 75, hrvPhase: 0,
};

// Estado del evento activo en el simulador
const simEvent = {
  active: false,
  type: 'normal' as SimMode,
  ticksLeft: 0,
  ticksBetweenEvents: 0, // contador para el proximo evento
  nextEventIn: 300,      // ticks hasta el proximo evento (~30s al inicio)
};

const EVENT_TYPES: Array<{ mode: SimMode; type: EventType; label: string; severity: 'high'|'medium'; durationTicks: number }> = [
  { mode: 'tachycardia', type: 'tachycardia',  label: 'Tachycardia Detected',    severity: 'high',   durationTicks: 200 },
  { mode: 'bradycardia', type: 'bradycardia',  label: 'Bradycardia Detected',    severity: 'high',   durationTicks: 150 },
  { mode: 'spo2drop',    type: 'spo2drop',     label: 'SpO2 Drop Detected',      severity: 'high',   durationTicks: 150 },
  { mode: 'fever',       type: 'fever',        label: 'Elevated Temperature',    severity: 'medium', durationTicks: 300 },
];

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function gaussian(std: number) { return ((Math.random()+Math.random()+Math.random()+Math.random())-2)*std; }

function updateSimState(mode: SimMode) {
  const tgt = SIM_TARGETS[mode];
  // Deriva muy lenta ~0.5% por tick de 100ms — cambios imperceptibles momento a momento
  simState.hr   = lerp(simState.hr,   tgt.hr,   0.005) + gaussian(0.15);
  simState.resp = lerp(simState.resp, tgt.resp,  0.003) + gaussian(0.05);
  simState.temp = lerp(simState.temp, tgt.temp,  0.002) + gaussian(0.008);
  simState.sys  = lerp(simState.sys,  tgt.sys,   0.003) + gaussian(0.2);
  simState.dia  = lerp(simState.dia,  tgt.dia,   0.003) + gaussian(0.15);
  // HRV: HR oscila ±2.5 BPM con periodo ~6s (variabilidad sinusal normal)
  simState.hrvPhase += 0.1 / 6;
  simState.hr = Math.max(30, simState.hr + Math.sin(simState.hrvPhase * 2 * Math.PI) * 0.25);
}

function simEcg(t: number, hr: number): number {
  const phase = (t * hr / 60) % 1;
  let v = 0;
  if      (phase < 0.04) v =  0.15 * Math.sin(phase / 0.04 * Math.PI);
  else if (phase < 0.10) v = -0.10 * Math.sin((phase - 0.04) / 0.06 * Math.PI);
  else if (phase < 0.18) v =  0.85 * Math.sin((phase - 0.10) / 0.08 * Math.PI);
  else if (phase < 0.22) v = -0.25 * Math.sin((phase - 0.18) / 0.04 * Math.PI);
  else if (phase < 0.38) v =  0.12 * Math.sin((phase - 0.22) / 0.16 * Math.PI);
  return Math.round((v + gaussian(0.012)) * 2_000_000);
}

function simPpg(t: number, hr: number): number {
  const phase = (t * hr / 60) % 1;
  return Math.round((Math.pow(Math.sin(phase * Math.PI), 2) * 0.75 + Math.random() * 0.008) * 8_000_000);
}

function simResp(t: number, resp: number): number {
  return Math.round(Math.sin(t * 2 * Math.PI * resp / 60) * 7_000_000);
}

function buildSimPacket(t: number, baseMode: SimMode): {
  timestamp: number;
  channels: number[][];
  newEvent: typeof EVENT_TYPES[0] | null;
} {
  // Decidir qué modo usar — base o evento activo
  let newEvent: typeof EVENT_TYPES[0] | null = null;

  simEvent.ticksBetweenEvents++;

  if (simEvent.active) {
    simEvent.ticksLeft--;
    if (simEvent.ticksLeft <= 0) {
      simEvent.active = false;
      // Siguiente evento en 300-600 ticks (~30-60s)
      simEvent.nextEventIn = 300 + Math.floor(Math.random() * 300);
      simEvent.ticksBetweenEvents = 0;
    }
  } else if (simEvent.ticksBetweenEvents >= simEvent.nextEventIn) {
    // Disparar nuevo evento aleatorio
    const pick = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
    simEvent.active    = true;
    simEvent.type      = pick.mode;
    simEvent.ticksLeft = pick.durationTicks;
    simEvent.ticksBetweenEvents = 0;
    newEvent = pick;
  }

  const currentMode = simEvent.active ? simEvent.type : baseMode;
  updateSimState(currentMode);
  const hr = simState.hr, resp = simState.resp, temp = simState.temp;
  const dt = 1 / 250;
  const channels: number[][] = Array.from({ length: 8 }, () => []);
  for (let s = 0; s < 25; s++) {
    const ts = t + s * dt;
    channels[0].push(simEcg(ts, hr));
    channels[1].push(Math.round(simEcg(ts, hr) * 0.85));
    channels[2].push(Math.round(simEcg(ts, hr) * 0.65));
    channels[3].push(Math.round(simEcg(ts, hr) * -0.5));
    channels[4].push(simResp(ts, resp));
    channels[5].push(simPpg(ts, hr));
    channels[6].push(Math.round(temp * 100_000 + gaussian(200)));
    channels[7].push(Math.round(Math.sin(ts * 2 * Math.PI * 80) * 20_000 * Math.random()));
  }
  return { timestamp: Math.round(t * 1000), channels, newEvent };
}

// ─── FIN SIMULADOR ────────────────────────────────────────────────────────────

// ─── Hook ─────────────────────────────────────────────────────────────────────

export const useWebSocket = () => {
  const setConnected        = useStore(s => s.setConnected);
  const setConnectionStatus = useStore(s => s.setConnectionStatus);
  const simulationMode      = useStore(s => s.simulationMode);
  const updateVitals        = useStore(s => s.updateVitals);
  const addAlert            = useStore(s => s.addAlert);
  const addEvent            = useStore(s => s.addEvent);
  const isLive              = useStore(s => s.isLive);
  const historyOffset       = useStore(s => s.historyOffset);

  const [waveforms, setWaveforms] = useState<number[][]>(
    VIEW_SIZES.map(n => new Array(n).fill(0))
  );

  const rings   = useRef<RingBuffer[]>(Array.from({ length: 8 }, () => new RingBuffer(BUFFER_SIZE)));
  const wsRef   = useRef<WebSocket | null>(null);
  const simRef  = useRef<ReturnType<typeof setInterval> | null>(null);
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
  const historyOffsetRef = useRef(historyOffset);
  const lastOffsetRef    = useRef(-1); // para detectar cambios en modo histórico
  useEffect(() => {
    historyOffsetRef.current = historyOffset;
    lastOffsetRef.current = -1; // forzar re-render al cambiar offset
  }, [historyOffset]);

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

      // En modo histórico: solo renderizar una vez al cambiar el offset,
      // no en cada frame — los waveforms quedan estáticos
      if (offsetSamples > 0 && offsetSamples === lastOffsetRef.current) return;
      lastOffsetRef.current = offsetSamples;

      // Waveforms
      const next = rings.current.map((ring, ch) => {
        const viewSize = VIEW_SIZES[ch];
        const dec      = DECIMATE[ch];
        const rawNeed  = viewSize * dec;

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
      // En modo histórico (offsetSamples > 0): NO actualizar vitales —
      // VitalsDisplay muestra el snapshot congelado del momento en que se entró al modo pasado
      vitalTick++;
      if (vitalTick < 30) return;
      vitalTick = 0;

      if (offsetSamples > 0) return; // ← vitales congelados, solo actualizar waveforms

      const ecg  = rings.current[0].slice(750);
      const ppg  = rings.current[5].slice(250);
      const resp = rings.current[4].slice(1500);
      const temp = rings.current[6].slice(25);

      const hr   = estimateHR(ecg);
      const spo2 = estimateSpO2(ppg);
      const rr   = estimateResp(resp);
      const tmp  = extractTemp(temp);

      if (hr > 0) updateVitals({ heartRate: {
        value: hr,
        trend: hr > 100 ? 'up' : hr < 55 ? 'down' : 'stable',
        severity: hr > 120 || hr < 45 ? 'critical' : hr > 100 || hr < 55 ? 'moderate' : 'normal',
      }});

      updateVitals({
        spo2:            { value: spo2, trend: spo2 < 94 ? 'down' : 'stable',            severity: spo2 < 90 ? 'critical' : spo2 < 94 ? 'moderate' : 'normal' },
        temperature:     { value: tmp,  trend: tmp > 37.5 ? 'up' : 'stable',             severity: tmp > 39  ? 'critical' : tmp > 37.5 ? 'moderate' : 'normal' },
        respirationRate: { value: rr > 0 ? rr : 16, trend: rr > 20 ? 'up' : rr < 12 ? 'down' : 'stable', severity: rr > 25 || rr < 10 ? 'critical' : 'normal' },
      });

      // Solo alertas en modo Live
      if (hr > 120)          addAlert({ timestamp: new Date().toLocaleTimeString(), message: `Elevated HR: ${hr} BPM`, severity: 'high'   });
      if (hr > 0 && hr < 45) addAlert({ timestamp: new Date().toLocaleTimeString(), message: `Low HR: ${hr} BPM`,      severity: 'high'   });
      if (spo2 < 90)         addAlert({ timestamp: new Date().toLocaleTimeString(), message: `SpO2 Drop: ${spo2}%`,    severity: 'high'   });
      if (tmp > 38.5)        addAlert({ timestamp: new Date().toLocaleTimeString(), message: `Fever: ${tmp}C`,         severity: 'medium' });
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
      simRef.current = setInterval(() => {
        simTime.current += 0.1;
        const { newEvent, ...packet } = buildSimPacket(simTime.current, simulationMode as SimMode);
        handlePacket(packet);
        // Si el simulador generó un evento nuevo, registrarlo en el store
        if (newEvent) {
          addEvent({
            type: newEvent.type as any,
            label: newEvent.label,
            severity: newEvent.severity,
            timestampEpoch: Date.now(),
          });
        }
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
