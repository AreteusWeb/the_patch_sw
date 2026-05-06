/**
 * ChestPad WebSocket Simulator
 * Corre con: node server.js
 * Requiere: npm install ws
 */

const { WebSocketServer } = require('ws');

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

// ─── Config de señales ───────────────────────────────────────────────────────
let simMode = 'normal';

const MODES = {
  normal:      { hr: 75,  spo2: 98,  temp: 36.6, resp: 16 },
  tachycardia: { hr: 135, spo2: 97,  temp: 36.8, resp: 20 },
  bradycardia: { hr: 42,  spo2: 98,  temp: 36.5, resp: 14 },
  spo2drop:    { hr: 80,  spo2: 88,  temp: 36.6, resp: 22 },
  fever:       { hr: 95,  spo2: 97,  temp: 39.2, resp: 20 },
};

// ─── Generadores de señal ────────────────────────────────────────────────────

function ecgSample(t, hr) {
  const period = 60 / hr;
  const phase  = (t % period) / period;
  let v = 0;
  if      (phase < 0.04) v =  Math.sin(phase / 0.04 * Math.PI) * 0.15;
  else if (phase < 0.10) v =  Math.sin((phase - 0.04) / 0.06 * Math.PI) * -0.10;
  else if (phase < 0.18) v =  Math.sin((phase - 0.10) / 0.08 * Math.PI) *  0.80; // QRS
  else if (phase < 0.22) v =  Math.sin((phase - 0.18) / 0.04 * Math.PI) * -0.25;
  else if (phase < 0.30) v =  Math.sin((phase - 0.22) / 0.08 * Math.PI) *  0.10;
  return Math.round((v + (Math.random() - 0.5) * 0.02) * 2_000_000);
}

function ppgSample(t, hr) {
  const period = 60 / hr;
  const phase  = (t % period) / period;
  const v = Math.pow(Math.sin(phase * Math.PI), 2) * 0.7 + Math.random() * 0.02;
  return Math.round(v * 8_388_607);
}

function respSample(t, resp) {
  const v = Math.sin(t * 2 * Math.PI * (resp / 60)) * 0.5;
  return Math.round(v * 8_388_607);
}

// Audio PCM a 8kHz (int16 little-endian) para ch7 auscultation
function buildBinaryPacket(t0, hr) {
  const SAMPLES = 800;
  const buf  = Buffer.alloc(SAMPLES * 2); // 1600 bytes
  const dt   = 1 / 8000;
  const period = 60 / hr;

  for (let i = 0; i < SAMPLES; i++) {
    const t     = t0 + i * dt;
    const phase = (t % period) / period;
    let v = 0;
    if      (phase < 0.04) v =  Math.sin(phase / 0.04 * Math.PI) * 3000;
    else if (phase < 0.10) v =  Math.sin((phase - 0.04) / 0.06 * Math.PI) * -800;
    else if (phase < 0.18) v =  Math.sin((phase - 0.10) / 0.08 * Math.PI) *  28000;
    else if (phase < 0.22) v =  Math.sin((phase - 0.18) / 0.04 * Math.PI) * -5000;
    else if (phase < 0.30) v =  Math.sin((phase - 0.22) / 0.08 * Math.PI) *  1500;
    v += (Math.random() - 0.5) * 200;
    buf.writeInt16LE(Math.round(v), i * 2);
  }
  return buf;
}

// JSON 8x25 matrix para todos los canales @ 250 Hz
function buildJSONPacket(timestamp, t0, cfg) {
  const SAMPLES = 25;
  const dt = 1 / 250;
  const channels = [];

  for (let ch = 0; ch < 8; ch++) {
    const row = [];
    for (let s = 0; s < SAMPLES; s++) {
      const t = t0 + s * dt;
      let v;
      if      (ch <= 3) v = ecgSample(t, cfg.hr) * (1 - ch * 0.08); // Leads I-III, aVR
      else if (ch === 4) v = respSample(t, cfg.resp);
      else if (ch === 5) v = ppgSample(t, cfg.hr);
      else if (ch === 6) v = Math.round((cfg.temp + (Math.random() - 0.5) * 0.01) * 100_000);
      else               v = Math.round(Math.sin(t * 2 * Math.PI * 200) * 8_000_000 * (0.5 + Math.random() * 0.5));
      row.push(Math.round(v));
    }
    channels.push(row);
  }

  return JSON.stringify({ timestamp, channels });
}

// ─── Servidor ────────────────────────────────────────────────────────────────

console.log(`\n🫀  ChestPad WS Simulator`);
console.log(`   Escuchando en ws://localhost:${PORT}/ws\n`);

wss.on('connection', (ws, req) => {
  let authenticated = false;
  let cycleInterval = null;
  let deviceTimestamp = 0; // ms desde power-on
  const connectedAt = Date.now();

  console.log(`[+] Cliente conectado desde ${req.socket.remoteAddress}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());

      // Auth handshake
      if (msg.type === 'auth' && msg.mac) {
        authenticated = true;
        console.log(`[AUTH] MAC: ${msg.mac} — OK`);
        ws.send(JSON.stringify({ type: 'auth_ok', mac: msg.mac }));

        // Arrancar ciclo de 100ms
        cycleInterval = setInterval(() => {
          if (ws.readyState !== ws.OPEN) return;

          const cfg = MODES[simMode] || MODES.normal;
          const t0  = deviceTimestamp / 1000; // en segundos

          // 1) Binary frame (audio @ 8kHz)
          const binPacket = buildBinaryPacket(t0, cfg.hr);
          ws.send(binPacket);

          // 2) JSON frame (8 canales @ 250Hz)
          const jsonPacket = buildJSONPacket(deviceTimestamp, t0, cfg);
          ws.send(jsonPacket);

          deviceTimestamp += 100;

          if ((deviceTimestamp / 100) % 50 === 0) {
            const uptime = ((Date.now() - connectedAt) / 1000).toFixed(1);
            console.log(`[OK] ts=${deviceTimestamp}ms | uptime=${uptime}s | mode=${simMode} | HR=${cfg.hr} SpO2=${cfg.spo2}`);
          }
        }, 100);
      }

      // Cambiar modo desde el cliente (opcional)
      if (msg.type === 'set_mode' && MODES[msg.mode]) {
        simMode = msg.mode;
        console.log(`[MODE] Cambiado a: ${simMode}`);
        ws.send(JSON.stringify({ type: 'mode_changed', mode: simMode }));
      }

    } catch (e) {
      console.warn('[WARN] Mensaje no-JSON ignorado, largo:', data.length);
    }
  });

  ws.on('close', () => {
    clearInterval(cycleInterval);
    console.log(`[-] Cliente desconectado`);
  });

  ws.on('error', (err) => {
    console.error('[ERR]', err.message);
    clearInterval(cycleInterval);
  });
});

// ─── Control por consola (cambia modo escribiendo en terminal) ───────────────
process.stdin.setEncoding('utf8');
process.stdin.on('data', (input) => {
  const cmd = input.trim().toLowerCase();
  if (MODES[cmd]) {
    simMode = cmd;
    console.log(`\n[MODE] → ${simMode} (HR=${MODES[cmd].hr}, SpO2=${MODES[cmd].spo2}, Temp=${MODES[cmd].temp})`);
  } else {
    console.log(`Modos disponibles: ${Object.keys(MODES).join(' | ')}`);
  }
});
