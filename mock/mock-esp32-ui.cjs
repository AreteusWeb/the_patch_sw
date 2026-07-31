/**
 * Mock ESP32 — UI / frontend testing
 *
 * Same wire format as mock-esp32.cjs, longer run (60s default, or infinite).
 *
 * Usage:
 *   node mock/mock-esp32-ui.cjs
 *
 * Requires the app MAC in profile to match MOCK_MAC (default AA:BB:CC:DD:EE:FF).
 */

const WebSocket = require('ws');
const {
  sampleForChannel,
  getSimVitalsAtSample,
  PHASE_SECONDS,
} = require('./mock-waveform-samples.cjs');

// ─── Config ───────────────────────────────────────────────────────────────
const SERVER_URL = process.env.SERVER_URL || 'wss://chestpad-ws-server-1048900719191.us-central1.run.app';
const MOCK_MAC = 'AA:BB:CC:DD:EE:FF';
const PACKETS_TO_SEND = 600; // 600 × 100 ms = 60 s (set 0 for infinite loop)
const SAMPLES_PER_PACKET = 25;
const PACKET_INTERVAL_MS = 100;
let lastLoggedPhase = -1;

const CHANNEL_NAMES = [
  'V6', 'V5', 'V4', 'V3', 'V2', 'V1', 'Lead II', 'Lead I', 'Resp', 'PPG',
];

let ws;
let packetsSent = 0;
let globalSampleCounter = 0;
let sendInterval;

function connect() {
  console.log(`[MOCK-UI] Connecting to ${SERVER_URL} ...`);
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('[MOCK-UI] Connection open, sending auth...');
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
    console.log('[MOCK-UI] Connection closed.');
    clearInterval(sendInterval);
  });

  ws.on('error', (err) => {
    console.error('[MOCK-UI] Error:', err.message);
  });
}

function startSendingPackets() {
  sendInterval = setInterval(() => {
    if (PACKETS_TO_SEND > 0 && packetsSent >= PACKETS_TO_SEND) {
      console.log(`[MOCK-UI] ${packetsSent} packets sent. Closing in 3s...`);
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

    const vitals = getSimVitalsAtSample(globalSampleCounter - 1);
    if (vitals.phase !== lastLoggedPhase) {
      lastLoggedPhase = vitals.phase;
      console.log(
        `[MOCK-UI] Vitals phase "${vitals.label}" → HR=${vitals.hr} Resp=${vitals.resp} SpO2=${vitals.spo2}` +
        ` (changes every ${PHASE_SECONDS}s — scrub timeline to verify past values)`
      );
    }

    if (packetsSent % 10 === 0) {
      const limit = PACKETS_TO_SEND > 0 ? `/${PACKETS_TO_SEND}` : '';
      console.log(`[MOCK-UI] Packet ${packetsSent}${limit} | HR=${vitals.hr} Resp=${vitals.resp}`);
    }
  }, PACKET_INTERVAL_MS);
}

connect();
