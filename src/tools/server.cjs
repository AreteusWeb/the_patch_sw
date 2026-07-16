/**
 * ChestPad WebSocket Simulator
 * Run with: node server.js
 * Requires: npm install ws
 */

const { WebSocketServer } = require('ws');

const PORT = 8080;
const wss = new WebSocketServer({ port: PORT });

// ─── Signal config ────────────────────────────────────────────────────────
let simMode = 'normal';

const MODES = {
  normal:      { hr: 75,  spo2: 98,  temp: 36.6, resp: 16 },
  tachycardia: { hr: 135, spo2: 97,  temp: 36.8, resp: 20 },
  bradycardia: { hr: 42,  spo2: 98,  temp: 36.5, resp: 14 },
  spo2drop:    { hr: 80,  spo2: 88,  temp: 36.6, resp: 22 },
  fever:       { hr: 95,  spo2: 97,  temp: 39.2, resp: 20 },
};

// ─── Signal generators ───────────────────────────────────────────────────

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



// JSON 11x25 matrix for all channels @ 250 Hz
function buildJSONPacket(timestamp, t0, cfg) {
  const SAMPLES = 25;
  const dt = 1 / 250;
  const channels = [];

  for (let ch = 0; ch < 11; ch++) {
    const row = [];
    for (let s = 0; s < SAMPLES; s++) {
      const t = t0 + s * dt;
      let v;
      if      (ch <= 7) v = ecgSample(t, cfg.hr) * (1 - ch * 0.08); // Leads I-III, V1-V5
      else if (ch === 8) v = respSample(t, cfg.resp);
      else if (ch === 9) v = ppgSample(t, cfg.hr);
      else if (ch === 10) v = Math.round((cfg.temp + (Math.random() - 0.5) * 0.01) * 100_000);
      row.push(Math.round(v));
    }
    channels.push(row);
  }

  return JSON.stringify({ timestamp, channels });
}

// ─── Server ────────────────────────────────────────────────────────────────

console.log(`\nChestPad WS Simulator`);
console.log(`   Listening on ws://localhost:${PORT}/ws\n`);

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

        // Start the 100 ms cycle
        cycleInterval = setInterval(() => {
          if (ws.readyState !== ws.OPEN) return;

          const cfg = MODES[simMode] || MODES.normal;
          const t0  = deviceTimestamp / 1000; // en segundos

          // JSON frame (11 canales @ 250Hz)
          const jsonPacket = buildJSONPacket(deviceTimestamp, t0, cfg);
          ws.send(jsonPacket);

          deviceTimestamp += 100;

          if ((deviceTimestamp / 100) % 50 === 0) {
            const uptime = ((Date.now() - connectedAt) / 1000).toFixed(1);
            console.log(`[OK] ts=${deviceTimestamp}ms | uptime=${uptime}s | mode=${simMode} | HR=${cfg.hr} SpO2=${cfg.spo2}`);
          }
        }, 100);
      }

      // Change mode from the client (optional)
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

// ─── Console control (change mode by typing in the terminal) ─────────────
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
