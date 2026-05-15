/**
 * ChestPad WebSocket Server — production + relay
 * Receives real data from ESP32 according to Data_format.docx
 * Relays data to connected web clients (React app) in real time
 *
 * Install: npm install ws
 * Run:     node server.cjs
 */

const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ port: PORT });

// ESP32 devices: deviceId -> { ws, lastSeen, packetCount }
const devices = new Map();

// Web clients (React app): Set of WebSockets
const webClients = new Set();

// The React app sends this hardcoded MAC — use it to tell apart device vs browser
const WEBCLIENT_MAC = 'A1:B2:C3:D4:E5:F6';

console.log(`\nChestPad WS Server running on port ${PORT}\n`);

wss.on('connection', (ws, req) => {
  ws.role = null;   // 'device' | 'webclient'
  ws.deviceId = null;
  ws.authenticated = false;

  console.log(`[+] New connection from ${req.socket.remoteAddress}`);

  const authTimeout = setTimeout(() => {
    if (!ws.authenticated) {
      console.log('[TIMEOUT] No auth in 15s, closing connection');
      ws.close();
    }
  }, 15_000);

  ws.on('message', (data, isBinary) => {

    // ── Binary packet — auscultation audio (1600 bytes / 800 int16 samples) ──
    if (isBinary) {
      if (ws.role !== 'device') return;

      // Relay raw binary to all web clients
      let relayed = 0;
      for (const client of webClients) {
        if (client.readyState === client.OPEN) {
          client.send(data, { binary: true });
          relayed++;
        }
      }
      console.log(`[BIN] device=${ws.deviceId} | audio samples=${data.byteLength / 2} | bytes=${data.byteLength} | relay→${relayed} clients`);
      return;
    }

    // ── JSON packet ───────────────────────────────────────────────────────────
    let msg;
    try {
      msg = JSON.parse(data.toString());
      console.log('[MSG]', JSON.stringify(msg).slice(0, 500));
    } catch (e) {
      console.warn('[WARN] Non-JSON message ignored');
      console.log('[RAW]', data.toString());
      return;
    }

    // ── Auth handshake ────────────────────────────────────────────────────────
    if (msg.type === 'auth' && msg.mac) {
      clearTimeout(authTimeout);
      ws.authenticated = true;

      if (msg.mac === WEBCLIENT_MAC) {
        // React app connecting
        ws.role = 'webclient';
        ws.deviceId = 'webclient';
        webClients.add(ws);
        console.log(`[AUTH OK] WEBCLIENT | active web clients=${webClients.size}`);
        ws.send(JSON.stringify({ type: 'auth_ok', role: 'webclient' }));

      } else {
        // ESP32 device connecting
        ws.role = 'device';
        ws.deviceId = msg.mac.replace(/:/g, '');
        devices.set(ws.deviceId, { ws, lastSeen: Date.now(), packetCount: 0 });
        console.log(`[AUTH OK] DEVICE deviceId=${ws.deviceId} | mac=${msg.mac}`);
        ws.send(JSON.stringify({ type: 'auth_ok', deviceId: ws.deviceId }));
      }
      return;
    }

    // ── 8x25 multichannel telemetry → relay to web clients ───────────────────
    if (msg.channels && ws.role === 'device') {
      const { timestamp, channels } = msg;

      if (!Array.isArray(channels) || channels.length === 0) {
        console.warn(`[WARN] Invalid channels from device=${ws.deviceId}`);
        return;
      }
      if (channels.length !== 8) {
        console.log(`[DEBUG] device=${ws.deviceId} sent ${channels.length} channels (expected 8)`);
      }

      const sess = devices.get(ws.deviceId);
      if (!sess) {
        console.warn(`[WARN] Session not found for device=${ws.deviceId}`);
        return;
      }

      sess.packetCount++;
      sess.lastSeen = Date.now();

      // Relay JSON to all web clients
      const payload = JSON.stringify({ timestamp, channels });
      let relayed = 0;
      for (const client of webClients) {
        if (client.readyState === client.OPEN) {
          client.send(payload);
          relayed++;
        }
      }

      if (sess.packetCount % 10 === 0) {
        const ecg0 = channels[0]?.[0] ?? 'N/A';
        const temp = channels[6]?.[0] ?? 'N/A';
        console.log(`[DATA] device=${ws.deviceId} | ts=${timestamp} | ecg[0]=${ecg0} | temp[0]=${temp} | relay→${relayed} clients`);
      }
    }
  });

  ws.on('close', () => {
    if (ws.role === 'device') {
      devices.delete(ws.deviceId);
      console.log(`[-] DEVICE disconnected: ${ws.deviceId} | active devices=${devices.size}`);
    } else if (ws.role === 'webclient') {
      webClients.delete(ws);
      console.log(`[-] WEBCLIENT disconnected | active web clients=${webClients.size}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[ERR] role=${ws.role ?? 'no-auth'} device=${ws.deviceId ?? 'no-auth'} | ${err.message}`);
  });
});

// Status log every 30s
setInterval(() => {
  console.log(`[STATUS] devices=${devices.size} | webclients=${webClients.size}`);
  for (const [id, s] of devices) {
    const secsAgo = Math.round((Date.now() - s.lastSeen) / 1000);
    console.log(`  · ${id} — last data ${secsAgo}s ago | packets=${s.packetCount}`);
  }
}, 30_000);
