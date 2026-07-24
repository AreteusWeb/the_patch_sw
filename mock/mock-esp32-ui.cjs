/**
 * Mock ESP32 — UI / frontend testing
 *
 * Same wire format as mock-esp32.cjs, but generates realistic ECG/Resp/PPG
 * waveforms scaled for rawToMv() on the React app (~±1 mV ECG, ~75 bpm).
 *
 * Usage:
 *   node mock/mock-esp32-ui.cjs
 *
 * Requires the app MAC in profile to match MOCK_MAC (default AA:BB:CC:DD:EE:FF).
 */

const WebSocket = require('ws');

// ─── Config ───────────────────────────────────────────────────────────────
const SERVER_URL = 'wss://chestpad-ws-server-1048900719191.us-central1.run.app';
const MOCK_MAC = 'AA:BB:CC:DD:EE:FF';
const PACKETS_TO_SEND = 600; // 600 × 100 ms = 60 s (set 0 for infinite loop)
const SAMPLES_PER_PACKET = 25;
const PACKET_INTERVAL_MS = 100;
const SAMPLE_RATE_HZ = 250;

const ADC_VAL_MAX = 8388607;
const ADC_VAL_MAX_MV = 1200;

const CHANNEL_NAMES = [
  'V6', 'V5', 'V4', 'V3', 'V2', 'V1', 'Lead II', 'Lead I', 'Resp', 'PPG',
];

const LEAD_SCALE = {
  'Lead I': 1.0,
  'Lead II': 1.0,
  V1: 0.65,
  V2: 0.75,
  V3: 0.85,
  V4: 0.9,
  V5: 0.95,
  V6: 0.8,
};

const simState = { hr: 75, resp: 16, spo2: 98 };

// ─── Waveform helpers (mV → raw ADC) ──────────────────────────────────────

function mvToRaw(mv) {
  const raw = Math.round((mv / ADC_VAL_MAX_MV) * ADC_VAL_MAX);
  return Math.max(-0x800000, Math.min(0x7fffff, raw));
}

function simEcgMv(t, hr) {
  const phase = (t * hr / 60) % 1;
  let v = 0;
  if (phase < 0.04) v = 0.15 * Math.sin((phase / 0.04) * Math.PI);
  else if (phase < 0.10) v = -0.10 * Math.sin(((phase - 0.04) / 0.06) * Math.PI);
  else if (phase < 0.18) v = 0.85 * Math.sin(((phase - 0.10) / 0.08) * Math.PI);
  else if (phase < 0.22) v = -0.25 * Math.sin(((phase - 0.18) / 0.04) * Math.PI);
  else if (phase < 0.38) v = 0.12 * Math.sin(((phase - 0.22) / 0.16) * Math.PI);
  return v + (Math.random() - 0.5) * 0.012;
}

function simRespMv(t, resp) {
  return Math.sin(t * 2 * Math.PI * resp / 60) * 2.2 + (Math.random() - 0.5) * 0.04;
}

function simPpgMv(t, hr, spo2) {
  const phase = (t * hr / 60) % 1;
  const amplitude = Math.max(0.25, (spo2 - 88) / 10);
  return Math.pow(Math.sin(phase * Math.PI), 2) * amplitude + Math.random() * 0.015;
}

function sampleForChannel(name, sampleIndex) {
  const t = sampleIndex / SAMPLE_RATE_HZ;

  if (name === 'Resp') return mvToRaw(simRespMv(t, simState.resp));
  if (name === 'PPG') return mvToRaw(simPpgMv(t, simState.hr, simState.spo2));

  const scale = LEAD_SCALE[name] ?? 1;
  return mvToRaw(simEcgMv(t, simState.hr) * scale);
}

// ─── WebSocket client ───────────────────────────────────────────────────────

let ws;
let packetsSent = 0;
let globalSampleCounter = 0;
let sendInterval;

function connect() {
  console.log(`[MOCK-UI] Conectando a ${SERVER_URL} ...`);
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('[MOCK-UI] Conexión abierta, enviando auth...');
    ws.send(JSON.stringify({ type: 'auth', mac: MOCK_MAC }));
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === 'auth_ok') {
      console.log(`[MOCK-UI] Auth OK — deviceId=${msg.deviceId}. Streaming UI waveforms...`);
      startSendingPackets();
    } else if (msg.type === 'auth_error') {
      console.error(`[MOCK-UI] Auth FAILED: ${msg.reason}`);
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('[MOCK-UI] Conexión cerrada.');
    clearInterval(sendInterval);
  });

  ws.on('error', (err) => {
    console.error('[MOCK-UI] Error:', err.message);
  });
}

function startSendingPackets() {
  sendInterval = setInterval(() => {
    if (PACKETS_TO_SEND > 0 && packetsSent >= PACKETS_TO_SEND) {
      console.log(`[MOCK-UI] ${packetsSent} packets enviados. Cerrando en 3s...`);
      clearInterval(sendInterval);
      setTimeout(() => ws.close(), 3000);
      return;
    }

    const channels = CHANNEL_NAMES.map((name, index) => {
      const samples = [];
      for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
        samples.push(sampleForChannel(name, globalSampleCounter + s));
      }
      return { index, name, samples };
    });

    globalSampleCounter += SAMPLES_PER_PACKET;
    ws.send(JSON.stringify({ timestamp: Date.now(), channels }));
    packetsSent++;

    if (packetsSent % 10 === 0) {
      const limit = PACKETS_TO_SEND > 0 ? `/${PACKETS_TO_SEND}` : '';
      console.log(`[MOCK-UI] Packet ${packetsSent}${limit} | HR≈${simState.hr} bpm`);
    }
  }, PACKET_INTERVAL_MS);
}

connect();
