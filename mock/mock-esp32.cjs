/**
 * Mock ESP32 — simulates a real device to test the full pipeline
 * (WebSocket → 10 s chunk → mV conversion → GCS) without depending on hardware.
 *
 * Sends EXACTLY the format confirmed by Axel (2026-07-14):
 *   - 10 fixed channels (V6, V5, V4, V3, V2, V1, Lead II, Lead I, Resp, PPG)
 *   - 25 samples per channel, every 100 ms (250 Hz)
 *   - channels: [{ index, name, samples }, ...]
 *
 * Usage:
 *   npm install ws
 *   node mock-esp32.cjs
 *
 * Adjust SERVER_URL and MOCK_MAC as needed.
 */

const WebSocket = require('ws');

// ─── Config ───────────────────────────────────────────────────────────────
const SERVER_URL = 'wss://chestpad-ws-server-1048900719191.us-central1.run.app';
const MOCK_MAC   = 'AA:BB:CC:DD:EE:FF'; // Fake MAC, easy to identify in logs/GCS
const PACKETS_TO_SEND = 100; // 100 packets * 100 ms = 10 s = 1 complete chunk
const SAMPLES_PER_PACKET = 25;
const PACKET_INTERVAL_MS = 100;

const CHANNEL_NAMES = [
  'V6', 'V5', 'V4', 'V3', 'V2', 'V1', 'Lead II', 'Lead I', 'Resp', 'PPG',
];

const ADC_VAL_MAX = 8388607; // 2^23 - 1, same value used by the server to detect "not connected"

// Generate a realistic raw value (a simple wave, not pure noise) for each channel
function generateSample(channelIndex, sampleGlobalIndex) {
  const amplitude = 200000 + channelIndex * 10000;
  const freq = 0.05 + channelIndex * 0.01;
  const noise = Math.floor(Math.random() * 5000);
  const base = Math.floor(Math.abs(Math.sin(sampleGlobalIndex * freq)) * amplitude);
  return base + noise;
}

let ws;
let packetsSent = 0;
let globalSampleCounter = 0;
let sendInterval;

function connect() {
  console.log(`[MOCK] Conectando a ${SERVER_URL} ...`);
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('[MOCK] Conexión abierta, enviando auth...');
    ws.send(JSON.stringify({ type: 'auth', mac: MOCK_MAC }));
  });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.log('[MOCK] Mensaje no-JSON recibido, ignorando');
      return;
    }

    if (msg.type === 'auth_ok') {
      console.log(`[MOCK] Auth OK — deviceId=${msg.deviceId}. Empezando a mandar packets...`);
      startSendingPackets();
    } else if (msg.type === 'auth_error') {
      console.error(`[MOCK] Auth FAILED: ${msg.reason}`);
      ws.close();
    }
  });

  ws.on('close', () => {
    console.log('[MOCK] Conexión cerrada.');
    clearInterval(sendInterval);
  });

  ws.on('error', (err) => {
    console.error('[MOCK] Error de conexión:', err.message);
  });
}

function startSendingPackets() {
  sendInterval = setInterval(() => {
    if (packetsSent >= PACKETS_TO_SEND) {
      console.log(`[MOCK] Se mandaron ${packetsSent} packets (10s completos). Esperando 3s antes de cerrar para dar tiempo al flush...`);
      clearInterval(sendInterval);
      setTimeout(() => ws.close(), 3000);
      return;
    }

    const channels = CHANNEL_NAMES.map((name, index) => {
      const samples = [];
      for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
        samples.push(generateSample(index, globalSampleCounter + s));
      }
      return { index, name, samples };
    });

    globalSampleCounter += SAMPLES_PER_PACKET;

    const packet = {
      timestamp: Date.now(),
      channels,
    };

    ws.send(JSON.stringify(packet));
    packetsSent++;

    if (packetsSent % 10 === 0) {
      console.log(`[MOCK] Packet ${packetsSent}/${PACKETS_TO_SEND} enviado`);
    }
  }, PACKET_INTERVAL_MS);
}

connect();
