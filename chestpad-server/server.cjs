/**
 * ChestPad WebSocket Server — production + relay
 * Receives real data from ESP32 according to Data_format.docx
 * Relays data to connected web clients (React app) in real time
 *
 * Install: npm install ws firebase-admin
 * Run:     node server.cjs
 */

const { WebSocketServer } = require('ws');
const admin = require('firebase-admin');

// ─── Firebase Admin ───────────────────────────────────────────────────────────
// En Cloud Run las credenciales se obtienen automáticamente del entorno.
// No se necesita service account key.
admin.initializeApp({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'areteus-chestpad-backend-dev',
});

const PORT = process.env.PORT || 8080;
const wss  = new WebSocketServer({ port: PORT });

// ESP32 devices: deviceId (MAC sin colons) → { ws, lastSeen, packetCount }
const devices = new Map();

// Web clients: Set de WebSockets
// Cada ws tiene: ws.uid, ws.deviceMac (MAC sin colons, para matching con devices)
const webClients = new Set();

console.log(`\nChestPad WS Server running on port ${PORT}\n`);

wss.on('connection', (ws, req) => {
  ws.role          = null;   // 'device' | 'webclient'
  ws.deviceId      = null;   // MAC sin colons (dispositivos) o null
  ws.deviceMac     = null;   // MAC sin colons del ESP32 vinculado (webclients)
  ws.uid           = null;   // Firebase UID (webclients)
  ws.authenticated = false;

  console.log(`[+] New connection from ${req.socket.remoteAddress}`);

  const authTimeout = setTimeout(() => {
    if (!ws.authenticated) {
      console.log('[TIMEOUT] No auth in 15s, closing connection');
      ws.close();
    }
  }, 15_000);

  ws.on('message', async (data, isBinary) => {

    // ── Binary packet — auscultation audio ───────────────────────────────────
    if (isBinary) {
      if (ws.role !== 'device') return;

      // Relay solo al webclient dueño de este dispositivo
      let relayed = 0;
      for (const client of webClients) {
        if (client.readyState === client.OPEN && client.deviceMac === ws.deviceId) {
          client.send(data, { binary: true });
          relayed++;
        }
      }
      console.log(`[BIN] device=${ws.deviceId} | bytes=${data.byteLength} | relay→${relayed} clients`);
      return;
    }

    // ── JSON packet ───────────────────────────────────────────────────────────
    let msg;
    try {
      msg = JSON.parse(data.toString());
      console.log('[MSG]', JSON.stringify(msg).slice(0, 500));
    } catch (e) {
      console.warn('[WARN] Non-JSON message ignored');
      return;
    }

    // ── Auth handshake ────────────────────────────────────────────────────────
    if (msg.type === 'auth') {

      // ── Webclient: JWT de Firebase ────────────────────────────────────────
      if (msg.token) {
        try {
          const decoded = await admin.auth().verifyIdToken(msg.token);

          clearTimeout(authTimeout);
          ws.authenticated = true;
          ws.role          = 'webclient';
          ws.uid           = decoded.uid;
          // Normalizar MAC igual que los devices (sin colons, uppercase)
          ws.deviceMac     = (msg.deviceMac ?? '').replace(/:/g, '').toUpperCase();

          webClients.add(ws);
          console.log(`[AUTH OK] WEBCLIENT | uid=${decoded.uid} | deviceMac=${ws.deviceMac} | webclients=${webClients.size}`);
          ws.send(JSON.stringify({ type: 'auth_ok', role: 'webclient', uid: decoded.uid }));

        } catch (err) {
          console.warn(`[AUTH FAIL] Invalid token — ${err.message}`);
          ws.send(JSON.stringify({ type: 'auth_error', reason: 'invalid_token' }));
          ws.close();
        }
        return;
      }

      // ── Device (ESP32): MAC — sin cambios ─────────────────────────────────
      if (msg.mac) {
        clearTimeout(authTimeout);
        ws.authenticated = true;
        ws.role          = 'device';
        ws.deviceId      = msg.mac.replace(/:/g, '').toUpperCase();
        devices.set(ws.deviceId, { ws, lastSeen: Date.now(), packetCount: 0 });
        console.log(`[AUTH OK] DEVICE | deviceId=${ws.deviceId} | mac=${msg.mac} | devices=${devices.size}`);
        ws.send(JSON.stringify({ type: 'auth_ok', deviceId: ws.deviceId }));
        return;
      }

      // ── Auth sin token ni mac ─────────────────────────────────────────────
      console.warn('[AUTH FAIL] No token or mac in auth message');
      ws.send(JSON.stringify({ type: 'auth_error', reason: 'missing_credentials' }));
      ws.close();
      return;
    }

    // ── 8x25 multichannel telemetry → relay dirigido ──────────────────────────
    if (msg.channels && ws.role === 'device') {
      const { timestamp, channels } = msg;

      if (!Array.isArray(channels) || channels.length === 0) {
        console.warn(`[WARN] Invalid channels from device=${ws.deviceId}`);
        return;
      }

      const sess = devices.get(ws.deviceId);
      if (!sess) {
        console.warn(`[WARN] Session not found for device=${ws.deviceId}`);
        return;
      }

      sess.packetCount++;
      sess.lastSeen = Date.now();

      // Relay SOLO al webclient cuyo deviceMac coincide con este dispositivo
      const payload = JSON.stringify({ timestamp, channels });
      let relayed = 0;
      for (const client of webClients) {
        if (client.readyState === client.OPEN && client.deviceMac === ws.deviceId) {
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
      console.log(`[-] DEVICE disconnected: ${ws.deviceId} | devices=${devices.size}`);
    } else if (ws.role === 'webclient') {
      webClients.delete(ws);
      console.log(`[-] WEBCLIENT disconnected uid=${ws.uid} | webclients=${webClients.size}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[ERR] role=${ws.role ?? 'no-auth'} | ${err.message}`);
  });
});

// Status log every 30s
setInterval(() => {
  console.log(`[STATUS] devices=${devices.size} | webclients=${webClients.size}`);
  for (const [id, s] of devices) {
    const secsAgo = Math.round((Date.now() - s.lastSeen) / 1000);
    console.log(`  · ${id} — last seen ${secsAgo}s ago | packets=${s.packetCount}`);
  }
}, 30_000);
