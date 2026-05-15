/**
 * ChestPad WebSocket Server — production
 * Receives real data from ESP32 according to Data_format.docx
 *
 * Install: npm install ws
 * Run:   node server.cjs
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

const sessions = new Map();

console.log(`\nChestPad WS Server running on port ${PORT}\n`);

wss.on('connection', (ws, req) => {
  ws.deviceId = null;
  ws.authenticated = false;
  ws.binaryType = 'arraybuffer';

  console.log(`[+] New connection from ${req.socket.remoteAddress}`);

  const authTimeout = setTimeout(() => {
    if (!ws.authenticated) {
      console.log('[TIMEOUT] No auth, closing connection');
      ws.close();
    }
  }, 15_000);

  ws.on('message', (data, isBinary) => {

    // BINARY packet — auscultation audio (1600 bytes / 800 int16 samples)
    if (isBinary) {
      if (!ws.authenticated) return;
      const samples = data.byteLength / 2;
      console.log(`[BIN] device=${ws.deviceId} | audio samples=${samples} | bytes=${data.byteLength}`);
      return;
    }

    // JSON packet
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.warn('[WARN] Non-JSON message ignored');
      return;
    }

    // Auth handshake
    if (msg.type === 'auth' && msg.mac) {
      clearTimeout(authTimeout);
      const deviceId = msg.mac.replace(/:/g, '');
      ws.deviceId = deviceId;
      ws.authenticated = true;
      sessions.set(deviceId, { ws, lastSeen: Date.now(), packetCount: 0 });
      console.log(`[AUTH OK] deviceId=${deviceId} | mac=${msg.mac}`);
      ws.send(JSON.stringify({ type: 'auth_ok', deviceId }));
      return;
    }

    //   8x25 multichannel telemetry
    if (msg.channels && ws.authenticated) {
      const { timestamp, channels } = msg;
      if (!Array.isArray(channels) || channels.length !== 8) {
        console.warn(`[WARN] Invalid channels device=${ws.deviceId}`);
        return;
      }
      const sess = sessions.get(ws.deviceId);
      sess.packetCount++;
      sess.lastSeen = Date.now();

      if (sess.packetCount % 10 === 0) {
        const ecg0 = channels[0]?.[0] ?? 'N/A';
        const temp = channels[6]?.[0] ?? 'N/A';
        console.log(`[DATA] device=${ws.deviceId} | ts=${timestamp} | ecg[0]=${ecg0} | temp[0]=${temp} | conectados=${sessions.size}`);
      }
    }
  });

  ws.on('close', () => {
    if (ws.deviceId) {
      sessions.delete(ws.deviceId);
      console.log(`[-] Disconnected: device=${ws.deviceId} | active=${sessions.size}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[ERR] device=${ws.deviceId ?? 'no auth'} | ${err.message}`);
  });
});

setInterval(() => {
  if (sessions.size === 0) return;
  console.log(`[STATUS] Active devices: ${sessions.size}`);
  for (const [id, s] of sessions) {
    const secsAgo = Math.round((Date.now() - s.lastSeen) / 1000);
    console.log(`  · ${id} — last data ${secsAgo}s ago | packets=${s.packetCount}`);
  }
}, 30_000);
