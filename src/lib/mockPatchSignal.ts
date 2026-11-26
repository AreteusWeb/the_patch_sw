/**
 * Browser stand-in for mock/mock-esp32-ui.cjs.
 * Speaks the device WebSocket only for The Patch Mock (AA:BB:CC:DD:EE:FF).
 * The server still stores those chunks; this does not invent a second path.
 */
import { WS_URL } from './appConfig';

export const MOCK_PATCH_MAC = 'AA:BB:CC:DD:EE:FF';

const ADC_VAL_MAX = 8388607;
const ADC_VAL_MAX_MV = 1200;
const SAMPLE_RATE_HZ = 250;
const PHASE_SECONDS = 60;
const SAMPLES_PER_PACKET = 25;
const PACKET_INTERVAL_MS = 100;

const CHANNEL_NAMES = [
  'V6', 'V5', 'V4', 'V3', 'V2', 'V1', 'Lead II', 'Lead I', 'Resp', 'PPG',
] as const;

const LEAD_SCALE: Record<string, number> = {
  'Lead I': 1.0,
  'Lead II': 1.0,
  V1: 0.65,
  V2: 0.75,
  V3: 0.85,
  V4: 0.9,
  V5: 0.95,
  V6: 0.8,
};

const VITAL_PHASES = [
  { hr: 72, resp: 14, spo2: 98 },
  { hr: 108, resp: 22, spo2: 95 },
  { hr: 64, resp: 13, spo2: 97 },
  { hr: 82, resp: 17, spo2: 96 },
];

export function isMockPatchMac(mac: string | null | undefined): boolean {
  const clean = String(mac || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
  return clean === 'AABBCCDDEEFF';
}

function vitalsAtTime(tSec: number) {
  const phase = Math.floor(tSec / PHASE_SECONDS) % VITAL_PHASES.length;
  return VITAL_PHASES[phase];
}

function mvToRaw(mv: number): number {
  const raw = Math.round((mv / ADC_VAL_MAX_MV) * ADC_VAL_MAX);
  return Math.max(-0x800000, Math.min(0x7fffff, raw));
}

function simEcgMv(t: number, hr: number): number {
  const phase = (t * hr / 60) % 1;
  let v = 0;
  if (phase < 0.04) v = 0.15 * Math.sin((phase / 0.04) * Math.PI);
  else if (phase < 0.10) v = -0.10 * Math.sin(((phase - 0.04) / 0.06) * Math.PI);
  else if (phase < 0.18) v = 0.85 * Math.sin(((phase - 0.10) / 0.08) * Math.PI);
  else if (phase < 0.22) v = -0.25 * Math.sin(((phase - 0.18) / 0.04) * Math.PI);
  else if (phase < 0.38) v = 0.12 * Math.sin(((phase - 0.22) / 0.16) * Math.PI);
  return v + (Math.random() - 0.5) * 0.012;
}

function sampleForChannel(name: string, sampleIndex: number): number {
  const t = sampleIndex / SAMPLE_RATE_HZ;
  const { hr, resp, spo2 } = vitalsAtTime(t);
  if (name === 'Resp') {
    return mvToRaw(Math.sin(t * 2 * Math.PI * resp / 60) * 2.2 + (Math.random() - 0.5) * 0.04);
  }
  if (name === 'PPG') {
    const phase = (t * hr / 60) % 1;
    const amplitude = Math.max(0.25, (spo2 - 88) / 10);
    return mvToRaw(Math.pow(Math.sin(phase * Math.PI), 2) * amplitude + Math.random() * 0.015);
  }
  return mvToRaw(simEcgMv(t, hr) * (LEAD_SCALE[name] ?? 1));
}

type Listener = (running: boolean) => void;

let socket: WebSocket | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let sampleCounter = 0;
let running = false;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(running);
}

function clearPackets() {
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
}

export function isMockSignalRunning(): boolean {
  return running;
}

export function subscribeMockSignal(listener: Listener): () => void {
  listeners.add(listener);
  listener(running);
  return () => listeners.delete(listener);
}

function sendPacket(ws: WebSocket) {
  if (ws.readyState !== WebSocket.OPEN) return;
  const channels = CHANNEL_NAMES.map((name, index) => {
    const samples: number[] = [];
    for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
      samples.push(sampleForChannel(name, sampleCounter + s));
    }
    return { index, name, samples };
  });
  sampleCounter += SAMPLES_PER_PACKET;
  ws.send(JSON.stringify({ timestamp: Date.now(), channels }));
}

export function startMockPatchSignal(): void {
  if (running || socket) return;
  sampleCounter = 0;
  running = true;
  emit();

  const ws = new WebSocket(WS_URL);
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws) return;
    ws.send(JSON.stringify({ type: 'auth', mac: MOCK_PATCH_MAC }));
  };

  ws.onmessage = (event) => {
    if (socket !== ws) return;
    let msg: { type?: string };
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (msg.type === 'auth_ok' && timer == null) {
      timer = setInterval(() => sendPacket(ws), PACKET_INTERVAL_MS);
    } else if (msg.type === 'auth_error') {
      stopMockPatchSignal();
    }
  };

  ws.onerror = () => {
    if (socket === ws) stopMockPatchSignal();
  };

  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    clearPackets();
    if (running) {
      running = false;
      emit();
    }
  };
}

export function stopMockPatchSignal(): void {
  clearPackets();
  const ws = socket;
  socket = null;
  const wasRunning = running;
  running = false;
  if (wasRunning) emit();
  if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
}
