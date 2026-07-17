/**
 * ChestPad WebSocket Server — production + relay + GCS persistence
 * Receives real data from ESP32 according to Data_format.docx
 * Relays data to connected web clients (React app) in real time
 * Buffers 10-second chunks per device, converts raw ADC → mV,
 * and writes them to GCS for the AI/preprocessing pipeline.
 *
 * CHANGE (2026-07-14): channel format updated per Axel's confirmation.
 * Before: channels: [[25 samples], [25 samples], ...] (array of arrays, positional)
 * Now:    channels: [{ index, name, samples: [25 samples] }, ...] (array of objects,
 *         with explicit index/name — order is no longer guessed).
 * Confirmed with Axel (2026-07-14): all 10 channels are always sent,
 * 25 samples/channel every 100ms (250Hz). The 11th channel (Temperature) is
 * still in development and not sent yet.
 *
 * Install: npm install ws firebase-admin @google-cloud/storage
 * Run:     node server.cjs
 */

const { WebSocketServer } = require('ws');
const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const http = require('http');

// ─── Firebase Admin ───────────────────────────────────────────────────────────
// On Cloud Run, credentials are obtained automatically from the environment.
// No service account key is needed.
admin.initializeApp({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'areteus-chestpad-backend-dev',
});

// ─── GCS ──────────────────────────────────────────────────────────────────────
// Same as Firebase Admin — on Cloud Run, credentials are obtained automatically
// from the service's service account, no key needed.
const storage = new Storage();
const BUCKET_NAME = process.env.GCS_BUCKET_NAME || 'areteus-patch-ecg-raw';
const bucket = storage.bucket(BUCKET_NAME);
const db = admin.firestore();

const PORT = process.env.PORT || 8080;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}
// Verifica el Firebase ID Token del header Authorization: Bearer <token>
async function verifyAuthHeader(req) {
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return decoded.uid;
  } catch (err) {
    console.warn(`[API AUTH FAIL] ${err.message}`);
    return null;
  }
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(JSON.stringify(obj));
}

function normalizeMac(mac) {
  return (mac || '').replace(/:/g, '').toUpperCase();
}
// ─── Handler principal de rutas /api/devices/* ───
// Regresa `true` si ya atendió el request, `false` si no era para él
async function handleDevicesApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!url.pathname.startsWith('/api/devices')) return false;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }

  const uid = await verifyAuthHeader(req);
  if (!uid) {
    sendJson(res, 401, { error: 'unauthorized' });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    const snap = await db.collection('devices').where('ownerUid', '==', uid).get();
    const devices = snap.docs.map(d => d.data());
    sendJson(res, 200, { devices });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/devices') {
    let body;
    try { body = await readJsonBody(req); }
    catch { sendJson(res, 400, { error: 'invalid_json' }); return true; }

    const deviceMac = normalizeMac(body.deviceMac);
    if (!deviceMac || deviceMac.length !== 12) {
      sendJson(res, 400, { error: 'invalid_mac' });
      return true;
    }

    const ref = db.collection('devices').doc(deviceMac);
    const existing = await ref.get();
    if (existing.exists) {
      sendJson(res, 409, { error: 'device_already_registered' });
      return true;
    }

    const deviceDoc = {
      deviceMac,
      ownerUid: uid,
      name: body.name || `Patch ${deviceMac.slice(-4)}`,
      firmwareVersion: null,
      registeredAt: Date.now(),
    };
    await ref.set(deviceDoc);
    console.log(`[DEVICE REGISTERED] mac=${deviceMac} owner=${uid}`);
    sendJson(res, 201, { device: deviceDoc });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/devices/')) {
    const deviceMac = normalizeMac(url.pathname.split('/').pop());
    const ref = db.collection('devices').doc(deviceMac);
    const existing = await ref.get();

    if (!existing.exists) {
      sendJson(res, 404, { error: 'not_found' });
      return true;
    }
    if (existing.data().ownerUid !== uid) {
      sendJson(res, 403, { error: 'not_owner' });
      return true;
    }

    await ref.delete();
    console.log(`[DEVICE DELETED] mac=${deviceMac} owner=${uid}`);
    sendJson(res, 200, { ok: true });
    return true;
  }

  sendJson(res, 404, { error: 'not_found' });
  return true;
}

// Plain HTTP server — responds to simple requests (Cloud Run health checks,
// browser, etc). Real WebSocket connections are "upgraded" from this same
// server.
const server = http.createServer(async (req, res) => {
  const handled = await handleDevicesApi(req, res);
  if (handled) return;

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ChestPad WS Server is running\n');
});

const wss = new WebSocketServer({ server });

server.listen(PORT, () => {
  console.log(`HTTP + WS server listening on port ${PORT}`);
});

// ESP32 devices: deviceId (MAC without colons) → { ws, lastSeen, packetCount }
const devices = new Map();

// Web clients: Set of WebSockets
// Each ws has: ws.uid, ws.deviceMac (MAC without colons, for matching with devices)
const webClients = new Set();

// ─── Chunking buffers (10s) for GCS, per device ──────────────────────────────
// chunkBuffers: deviceId -> { channelData: Map<index, {name, samples:[]}>, startTs, packetCount }
const chunkBuffers = new Map();

// Raw → mV conversion constants, confirmed by Axel (2026-07-13):
// voltage_mV = (raw / ADC_VAL_MAX) * ADC_VAL_MAX_MV
// ADC_VAL_MAX (8388607) is also the value reported by a channel with NO
// sensor connected (floating pin) — it must be filtered out as "not
// connected", not as an actual 1200mV reading.
const ADC_VAL_MAX = 8388607;
const ADC_VAL_MAX_MV = 1200;

// 100ms packets, 25 samples/channel each.
// 250Hz * 10s = 2500 samples/channel = 100 packets of 25 samples.
const PACKETS_PER_CHUNK = 100;

// CHANGE: channel names confirmed by Axel (2026-07-14). Order is no longer
// guessed — the ESP32 sends an explicit `name` per channel. This map is
// only used as a fallback in case a packet ever arrives without `name`
// (shouldn't happen under normal conditions).
const FALLBACK_CHANNEL_NAMES = {
  0: 'V6',
  1: 'V5',
  2: 'V4',
  3: 'V3',
  4: 'V2',
  5: 'V1',
  6: 'Lead II',
  7: 'Lead I',
  8: 'Resp',
  9: 'PPG',
  10: 'Temperature', // TODO: in development by Axel, not sent yet
};

// raw ADC value -> mV, or null if the channel has no sensor connected
function rawToMv(raw) {
  if (raw === ADC_VAL_MAX) return null; // sensor not connected (floating pin)
  return (raw / ADC_VAL_MAX) * ADC_VAL_MAX_MV;
}

console.log(`\nChestPad WS Server running on port ${PORT}\n`);

// ─── Accumulates 100ms packets until a 10s chunk is complete, then uploads it ─
// CHANGE: channelsArr is now [{ index, name, samples: [...] }, ...]
function onChannelsPacket(deviceId, timestamp, channelsArr) {
  let buf = chunkBuffers.get(deviceId);
  if (!buf) {
    buf = { channelData: new Map(), startTs: timestamp, packetCount: 0 };
    chunkBuffers.set(deviceId, buf);
  }

  for (const ch of channelsArr) {
    const idx = ch.index;
    const name = ch.name || FALLBACK_CHANNEL_NAMES[idx] || `CH_${idx}`;

    if (!Array.isArray(ch.samples)) {
      console.warn(`[WARN] Channel with invalid samples, device=${deviceId} idx=${idx}`);
      continue;
    }

    if (!buf.channelData.has(idx)) {
      buf.channelData.set(idx, { name, samples: [] });
    }
    buf.channelData.get(idx).samples.push(...ch.samples);
  }

  buf.packetCount++;

  if (buf.packetCount >= PACKETS_PER_CHUNK) {
    flushChunkToGCS(deviceId, buf).catch(err => {
      console.error(`[GCS ERROR] device=${deviceId} | ${err.message}`);
      // TODO: no retry/local persistence for now (conscious decision,
      // see pipeline proposal) — if the flush fails, that chunk is lost.
    });
    chunkBuffers.delete(deviceId);
  }
}

async function flushChunkToGCS(deviceId, buf) {
  // CHANGE: sort by channel index so the chunk always comes out consistent
  // regardless of the order channels arrived in within each packet.
  const sortedIndices = [...buf.channelData.keys()].sort((a, b) => a - b);
  const channel_labels = sortedIndices.map(i => buf.channelData.get(i).name);
  const data = sortedIndices.map(i => buf.channelData.get(i).samples.map(rawToMv));

  const metadata = {
    device_id: deviceId,
    timestamp_start: buf.startTs,
    sample_rate_hz: 250,
    num_channels: data.length,
    channel_labels,
  };

  const payload = JSON.stringify({ metadata, data });
  const dateStr = new Date().toISOString().slice(0, 10);
  const path = `${deviceId}/${dateStr}/${buf.startTs}.json`;

  await bucket.file(path).save(payload, { contentType: 'application/json' });
  console.log(`[GCS] device=${deviceId} | chunk written → gs://${BUCKET_NAME}/${path} | channels=${channel_labels.join(',')} | samples/ch=${data[0]?.length ?? 0}`);
}

wss.on('connection', (ws, req) => {
  ws.role          = null;   // 'device' | 'webclient'
  ws.deviceId      = null;   // MAC without colons (devices) or null
  ws.deviceMac     = null;   // MAC without colons of the linked ESP32 (webclients)
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

      // Relay only to the webclient that owns this device
      let relayed = 0;
      for (const client of webClients) {
        if (client.readyState === client.OPEN && client.deviceMac === ws.deviceId) {
          client.send(data, { binary: true });
          relayed++;
        }
      }
      console.log(`[BIN] device=${ws.deviceId} | bytes=${data.byteLength} | relay→${relayed} clients`);
      // NOTE: auscultation audio does NOT enter the GCS/AI pipeline —
      // Jennifer confirmed the model only uses ECG signals. This binary
      // frame stays only in the live relay to the frontend, as before.
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

      // ── Webclient: Firebase JWT ────────────────────────────────────────────
      if (msg.token) {
        try {
          const decoded = await admin.auth().verifyIdToken(msg.token);

          clearTimeout(authTimeout);
          ws.authenticated = true;
          ws.role          = 'webclient';
          ws.uid           = decoded.uid;
          // Normalize MAC the same way as devices (no colons, uppercase)
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

      // ── Device (ESP32): MAC — unchanged ───────────────────────────────────
      if (msg.mac) {
        clearTimeout(authTimeout);
        ws.authenticated = true;
        ws.role          = 'device';
        ws.deviceId      = msg.mac.replace(/:/g, '').toUpperCase();

        devices.set(ws.deviceId, {
          ws,
          lastSeen: Date.now(),
          packetCount: 0,
        });
        console.log(`[AUTH OK] DEVICE | deviceId=${ws.deviceId} | mac=${msg.mac} | devices=${devices.size}`);
        ws.send(JSON.stringify({ type: 'auth_ok', deviceId: ws.deviceId }));
        return;
      }

      // ── Auth without token or mac ──────────────────────────────────────────
      console.warn('[AUTH FAIL] No token or mac in auth message');
      ws.send(JSON.stringify({ type: 'auth_error', reason: 'missing_credentials' }));
      ws.close();
      return;
    }

    // ── Multichannel telemetry → relay + GCS ───────────────────────────────
    // CHANGE: msg.channels is now [{ index, name, samples }, ...]
    if (msg.channels && ws.role === 'device') {
      const { timestamp, channels } = msg;

      if (!Array.isArray(channels) || channels.length === 0) {
        console.warn(`[WARN] Invalid channels from device=${ws.deviceId}`);
        return;
      }

      let sess = devices.get(ws.deviceId);
      if (!sess) {
        console.warn(`[WARN] Session not found for device=${ws.deviceId}, re-registering`);
        sess = { ws, lastSeen: Date.now(), packetCount: 0 };
        devices.set(ws.deviceId, sess);
      }

      sess.packetCount++;
      sess.lastSeen = Date.now();

      // Relay ONLY to the webclient whose deviceMac matches this device
      // (live behavior, unchanged — still sends raw values, not mV, so as
      // not to break what the frontend already consumes)
      const payload = JSON.stringify({ timestamp, channels });
      let relayed = 0;
      for (const client of webClients) {
        if (client.readyState === client.OPEN && client.deviceMac === ws.deviceId) {
          client.send(payload);
          relayed++;
        }
      }

      // NEW: accumulate into the 10s chunk and upload to GCS once complete
      onChannelsPacket(ws.deviceId, timestamp, channels);

      if (sess.packetCount % 10 === 0) {
        // CHANGE: we no longer assume fixed positions [0] and [9] — look up by name
        const v6 = channels.find(c => c.name === 'V6' || c.index === 0)?.samples?.[0] ?? 'N/A';
        const resp = channels.find(c => c.name === 'Resp' || c.index === 8)?.samples?.[0] ?? 'N/A';
        console.log(`[DATA] device=${ws.deviceId} | ts=${timestamp} | V6[0]=${v6} | Resp[0]=${resp} | channels=${channels.length} | relay→${relayed} clients`);
      }
    }
  });

  ws.on('close', () => {
    if (ws.role === 'device') {
      devices.delete(ws.deviceId);
      chunkBuffers.delete(ws.deviceId); // TODO: today the in-progress partial chunk is lost; see fault-tolerance note in the proposal
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
    const chunkProgress = chunkBuffers.get(id)?.packetCount ?? 0;
    console.log(`  · ${id} — last seen ${secsAgo}s ago | packets=${s.packetCount} | chunk progress=${chunkProgress}/${PACKETS_PER_CHUNK}`);
  }
}, 30_000);
