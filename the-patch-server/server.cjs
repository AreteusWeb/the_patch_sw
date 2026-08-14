/**
 * The Patch WebSocket Server — relay + provider-agnostic persistence
 * Receives real data from ESP32 according to Data_format.docx
 * Relays data to connected web clients (React app) in real time
 * Buffers 10-second chunks per device, converts raw ADC → mV,
 * and writes them via storage-provider for the AI/preprocessing pipeline.
 *
 * CHANGE (2026-07-14): channel format updated per Axel's confirmation.
 * Before: channels: [[25 samples], [25 samples], ...] (array of arrays, positional)
 * Now:    channels: [{ index, name, samples: [25 samples] }, ...] (array of objects,
 *         with explicit index/name — order is no longer guessed).
 * Confirmed with Axel (2026-07-14): all 10 channels are always sent,
 * 25 samples/channel every 100ms (250Hz). The 11th channel (Temperature) is
 * still in development and not sent yet.
 *
 * CHANGE (wrappers): this file no longer imports firebase-admin or
 * @google-cloud/storage directly. All of that logic lives behind
 * ./providers/{auth,storage,db,ai}-provider.cjs, selected by the APP_MODE
 * environment variable:
 *   - APP_MODE=cloud (default) -> real Firebase Auth + Firestore + GCS + Vertex AI
 *   - APP_MODE=local           -> no real auth, memory instead of
 *                                 Firestore, disk instead of GCS, mock AI coach
 * Thus, switching providers in the future (S3, Postgres, Supabase, etc.)
 * only requires adding a new file in providers/ — this server.cjs is not
 * touched.
 *
 * Install (cloud): npm install ws firebase-admin @google-cloud/storage @google-cloud/vertexai
 * Install (local): npm install ws   (firebase-admin/@google-cloud/* are not
 *                   loaded at all when APP_MODE=local)
 * Run:     node server.cjs
 */

const { WebSocketServer } = require('ws');
const http = require('http');

// Always load the-patch-server/.env (next to this file), NOT the repo-root
// .env. Running `node the-patch-server/server.cjs` from the monorepo root
// would otherwise pick up the frontend .env (cwd) and can flip APP_MODE.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const authProvider = require('./providers/auth-provider.cjs');
const storageProvider = require('./providers/storage-provider.cjs');
const dbProvider = require('./providers/db-provider.cjs');
const aiProvider = require('./providers/ai-provider.cjs');

const APP_MODE = (process.env.APP_MODE || 'cloud').toLowerCase();
const PORT = process.env.PORT || 8080;
const MAX_MESSAGES_PER_SESSION = Math.max(
  1,
  Number.parseInt(process.env.MAX_MESSAGES_PER_SESSION || '40', 10) || 40
);

// Dev origins always allowed (Vite --port=3000 --host=0.0.0.0).
// CORS_ALLOWED_ORIGINS adds production (or other) origins; it does not replace these.
const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://192.168.1.72:3000',
];

function parseCorsOrigins(raw) {
  if (!raw || typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

const ALLOWED_ORIGINS = new Set([
  ...DEFAULT_CORS_ORIGINS,
  ...parseCorsOrigins(process.env.CORS_ALLOWED_ORIGINS),
]);

console.log(`[BOOT] APP_MODE=${APP_MODE}${APP_MODE === 'local' ? ' (no Firebase/GCS — data in memory/disk)' : ''}`);
console.log(`[BOOT] CORS origins: ${[...ALLOWED_ORIGINS].join(', ')}`);

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
// Verifies the session token from Authorization: Bearer <token>
// (delegated to auth-provider — does not know whether Firebase or local is used)
async function verifyAuthHeader(req) {
  const authHeader = req.headers['authorization'] || '';
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match && !authProvider.isLocalMode()) return null;
  try {
    const result = await authProvider.verifyToken(match ? match[1] : null);
    return result ? result.uid : null;
  } catch (err) {
    console.warn(`[API AUTH FAIL] ${err.message}`);
    return null;
  }
}

/**
 * Echo request Origin when allowlisted. Do not use '*' — Authorization
 * requests are credentialed and browsers reject '*' with them.
 * @param {import('http').IncomingMessage} req
 */
function corsHeaders(req) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
  const origin = req?.headers?.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  return headers;
}

function sendJson(req, res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(obj));
}

function normalizeMac(mac) {
  return (mac || '').replace(/:/g, '').toUpperCase();
}
// ─── Main handler for /api/devices/* routes ───
// Returns `true` if the request was handled, `false` if it was not for this handler
async function handleDevicesApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!url.pathname.startsWith('/api/devices')) return false;

  const uid = await verifyAuthHeader(req);
  if (!uid) {
    sendJson(req, res, 401, { error: 'unauthorized' });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/devices') {
    const devices = await dbProvider.getDevicesByOwner(uid);
    sendJson(req, res, 200, { devices });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/devices') {
    let body;
    try { body = await readJsonBody(req); }
    catch { sendJson(req, res, 400, { error: 'invalid_json' }); return true; }

    const deviceMac = normalizeMac(body.deviceMac);
    if (!deviceMac || deviceMac.length !== 12) {
      sendJson(req, res, 400, { error: 'invalid_mac' });
      return true;
    }

    const existing = await dbProvider.getDeviceByMac(deviceMac);
    if (existing) {
      sendJson(req, res, 409, { error: 'device_already_registered' });
      return true;
    }

    const deviceDoc = {
      deviceMac,
      ownerUid: uid,
      name: body.name || `Patch ${deviceMac.slice(-4)}`,
      firmwareVersion: null,
      registeredAt: Date.now(),
    };
    await dbProvider.createDevice(deviceDoc);
    console.log(`[DEVICE REGISTERED] mac=${deviceMac} owner=${uid}`);
    sendJson(req, res, 201, { device: deviceDoc });
    return true;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/devices/')) {
    const deviceMac = normalizeMac(url.pathname.split('/').pop());
    const existing = await dbProvider.getDeviceByMac(deviceMac);

    if (!existing) {
      sendJson(req, res, 404, { error: 'not_found' });
      return true;
    }
    if (existing.ownerUid !== uid) {
      sendJson(req, res, 403, { error: 'not_owner' });
      return true;
    }

    await dbProvider.deleteDevice(deviceMac);
    console.log(`[DEVICE DELETED] mac=${deviceMac} owner=${uid}`);
    sendJson(req, res, 200, { ok: true });
    return true;
  }

  sendJson(req, res, 404, { error: 'not_found' });
  return true;
}

// ─── PHASE 2 — OTA (trigger firmware update) ──────────────────────────────
// This keeps the owner check aligned with the current frontend model, where
// the user's profile stores a single device MAC in users/{uid}.deviceMac.
const OTA_URL_EXPIRY_MS = 60 * 60 * 1000;

async function handleOtaApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/ota')) return false;

  const uid = await verifyAuthHeader(req);
  if (!uid) {
    sendJson(req, res, 401, { error: 'unauthorized' });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/ota/trigger') {
    let body;
    try { body = await readJsonBody(req); }
    catch { sendJson(req, res, 400, { error: 'invalid_json' }); return true; }

    const mac = normalizeMac(body.mac);
    const version = (body.version || '').trim();

    if (!mac || mac.length !== 12) {
      sendJson(req, res, 400, { error: 'invalid_mac' });
      return true;
    }
    if (!version) {
      sendJson(req, res, 400, { error: 'missing_version' });
      return true;
    }

    const userDoc = await dbProvider.getUser(uid);
    const ownedMac = normalizeMac(userDoc?.deviceMac);
    if (!ownedMac || ownedMac !== mac) {
      sendJson(req, res, 403, { error: 'not_owner' });
      return true;
    }

    const deviceSession = devices.get(mac);
    if (!deviceSession || deviceSession.ws.readyState !== deviceSession.ws.OPEN) {
      sendJson(req, res, 409, { error: 'device_offline' });
      return true;
    }

    const firmwarePath = `firmware/${version}/update.bin`;
    const firmware = await storageProvider.getFirmwareDownloadUrl(firmwarePath);
    if (!firmware.exists) {
      sendJson(req, res, 404, { error: 'firmware_not_found', path: firmwarePath });
      return true;
    }

    deviceSession.ws.send(JSON.stringify({ type: 'ota', url: firmware.url, version }));
    console.log(`[OTA] Triggered device=${mac} version=${version} by uid=${uid}`);

    await dbProvider.setUserOtaTriggered(uid, {
      lastOtaTriggeredVersion: version,
      lastOtaTriggeredAt: Date.now(),
    });

    sendJson(req, res, 200, { ok: true, version, expiresInMs: OTA_URL_EXPIRY_MS });
    return true;
  }

  sendJson(req, res, 404, { error: 'not_found' });
  return true;
}

// ─── AI Coach — chat message ─────────────────────────────────────────────────
// Historical metrics / sessions / alerts are fetched via function calling
// (tools), not stuffed into the prompt — never attach raw waveforms.
const COACH_SYSTEM_PROMPT_PLACEHOLDER = `You are the AI Coach for The Patch, a performance and recovery assistant for the athlete you're monitoring.

YOUR ROLE:
- Give practical tips on training, recovery, hydration, sleep, and effort management, based on the athlete's data.
- Tone: motivating, direct, concise — like a coach, not a doctor or a generic chatbot. Keep responses to 2-4 sentences or short lists, never long paragraphs.
- Use the available tools (get_current_metrics, get_trend, get_session_history, get_recent_alerts, search_reference_image) whenever the question calls for data you don't already have, instead of assuming values.
- For any live metric question (recovery, HR, SpO2, etc.), call get_current_metrics first and quote those numbers exactly.
- For trends / "this week" / averages: only use values returned by get_trend. If values is empty, average is null, or sampleCount is less than 2, say you don't have enough history yet and report only the current metric — never invent a weekly average or "constant" number.
- When you use the search_reference_image tool and get a result, do NOT include the image URL, markdown image syntax (e.g. ![text](url) or [text](url)), or any link to the photo in your text response — the image is already displayed to the user automatically as an attachment below your message. Just reference it naturally in words, e.g. "Here's a kettlebell:" without the markdown/URL.
- Respond in the same language the athlete writes in (English or Spanish). If unclear, default to English.

WHAT YOU NEVER DO:
- Never give medical diagnoses or interpret symptoms as health conditions.
- Never say things like "this could be arrhythmia" or "you may have X condition." If a metric is out of normal range, frame it as a performance data point, not a clinical finding.
- Never invent metric values you weren't given or didn't retrieve via a tool. Never invent historical averages, weekly constants, or trends that tools did not return.
- If the athlete asks about something medically serious (acute pain, injury, concerning symptoms), respond with empathy and redirect them to a healthcare professional — don't try to solve it yourself.

When relevant to a health-adjacent question, close with a brief reminder that this is performance coaching, not medical advice — but don't repeat it as a fixed signature on every message.`;

function sanitizeCoachMetricsSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Explicit allow-list — never persist ECG/pleth/waveform payloads.
  return {
    heartRate: raw.heartRate ?? null,
    spo2: raw.spo2 ?? null,
    respirationRate: raw.respirationRate ?? null,
    temperature: raw.temperature ?? null,
    hrvProxyMs: raw.hrvProxyMs ?? null,
    recoveryScore: raw.recoveryScore ?? null,
    hasRealData: Boolean(raw.hasRealData),
  };
}

/**
 * Close a coach session after generating a Gemini summary of its messages.
 * Shared by idle-timeout rollover and POST /api/coach/new-session.
 */
async function closeSessionWithSummary(uid, sessionId) {
  const oldMessages = await dbProvider.getRecentMessages(uid, sessionId, 50);
  let summary = null;
  try {
    summary = await aiProvider.generateSessionSummary({
      messages: oldMessages,
      uid,
      sessionId,
    });
  } catch (summaryErr) {
    console.warn(`[COACH] Session summary failed for uid=${uid}:`, summaryErr.message);
    summary = null;
  }
  await dbProvider.closeSession(uid, sessionId, summary);
}

async function handleCoachApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (!url.pathname.startsWith('/api/coach')) return false;

  const uid = await verifyAuthHeader(req);
  if (!uid) {
    sendJson(req, res, 401, { error: 'unauthorized' });
    return true;
  }

  // ── Start a fresh coaching conversation on demand ────────────────────────
  if (req.method === 'POST' && url.pathname === '/api/coach/new-session') {
    let body = {};
    try { body = await readJsonBody(req); }
    catch { sendJson(req, res, 400, { error: 'invalid_json' }); return true; }

    const metricsSnapshot = sanitizeCoachMetricsSnapshot(body.metricsSnapshot);

    try {
      const active = await dbProvider.getActiveSession(uid);
      if (active) {
        await closeSessionWithSummary(uid, active.sessionId);
      }
      const session = await dbProvider.createSession(uid, metricsSnapshot);
      sendJson(req, res, 200, { sessionId: session.sessionId });
      return true;
    } catch (err) {
      console.error('[coach/new-session] error:', err?.stack || err);
      sendJson(req, res, 500, { error: 'coach_failed' });
      return true;
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/coach/message') {
    let body;
    try { body = await readJsonBody(req); }
    catch { sendJson(req, res, 400, { error: 'invalid_json' }); return true; }

    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      sendJson(req, res, 400, { error: 'missing_message' });
      return true;
    }

    const metricsSnapshot = sanitizeCoachMetricsSnapshot(body.metricsSnapshot);

    try {
      // Session lifecycle lives here (not in db-provider) so we can summarize
      // via ai-provider before closing an idle session.
      let session = await dbProvider.getActiveSession(uid);
      if (!session) {
        const expiredSession = await dbProvider.getMostRecentSession(uid);
        if (expiredSession && !expiredSession.closedAt) {
          await closeSessionWithSummary(uid, expiredSession.sessionId);
        }
        session = await dbProvider.createSession(uid, metricsSnapshot);
      }

      const sessionId = session.sessionId;
      // Count existing messages before accepting a new turn (hard cost cap).
      const existingMessages = await dbProvider.getRecentMessages(
        uid,
        sessionId,
        MAX_MESSAGES_PER_SESSION
      );
      if (existingMessages.length >= MAX_MESSAGES_PER_SESSION) {
        sendJson(req, res, 429, {
          error: 'session_limit_reached',
          message:
            'This coaching session has reached its message limit. Please start a new conversation.',
        });
        return true;
      }

      const recentMessages = existingMessages.length <= 20
        ? existingMessages
        : existingMessages.slice(-20);

      await dbProvider.appendMessage(uid, sessionId, {
        role: 'user',
        text: message,
        metricsSnapshot,
        toolCalls: [],
      });

      const history = recentMessages.map(m => ({
        role: m.role === 'model' ? 'model' : 'user',
        text: m.text,
      }));

      // Tool handlers are injected from db-provider (bound to this uid).
      // ai-provider must not import db-provider itself.
      // Unsplash search lives in ai-provider (not DB).
      const toolHandlers = {
        get_current_metrics: async () => {
          if (metricsSnapshot) return metricsSnapshot;
          return dbProvider.getLatestMetricsSnapshot(uid);
        },
        get_session_history: async (args = {}) =>
          dbProvider.getSessionHistory(uid, { limit: args.limit ?? 5 }),
        get_trend: async (args = {}) =>
          dbProvider.getMetricTrend(uid, {
            metric: args.metric,
            days: args.days ?? 7,
          }),
        get_recent_alerts: async (args = {}) =>
          dbProvider.getRecentAlerts(uid, { limit: args.limit ?? 10 }),
        search_reference_image: async (args = {}) =>
          aiProvider.searchReferenceImage({ query: args.query }),
      };

      const reply = await aiProvider.generateCoachReply({
        systemPrompt: COACH_SYSTEM_PROMPT_PLACEHOLDER,
        history,
        userMessage: message,
        tools: aiProvider.getCoachTools(),
        toolHandlers,
        uid,
        sessionId,
      });

      const toolCalls = Array.isArray(reply.toolCalls) ? reply.toolCalls : [];
      const attachments = [];
      for (const call of toolCalls) {
        if (call?.name !== 'search_reference_image') continue;
        const result = call.result;
        if (result && typeof result.imageUrl === 'string' && result.imageUrl) {
          attachments.push({
            type: 'image',
            imageUrl: result.imageUrl,
            photographerName:
              typeof result.photographerName === 'string'
                ? result.photographerName
                : 'Unknown',
            photographerProfileUrl:
              typeof result.photographerProfileUrl === 'string'
                ? result.photographerProfileUrl
                : 'https://unsplash.com',
          });
        }
      }

      await dbProvider.appendMessage(uid, sessionId, {
        role: 'model',
        text: reply.text,
        metricsSnapshot: null,
        toolCalls,
        attachments,
      });

      sendJson(req, res, 200, {
        sessionId,
        reply: reply.text,
        attachments,
      });
      return true;
    } catch (err) {
      console.error('[coach/message] error:', err?.stack || err);
      sendJson(req, res, 500, { error: 'coach_failed' });
      return true;
    }
  }

  // ── Gemini Live API ephemeral token (POC only — no Firestore) ────────────
  if (req.method === 'POST' && url.pathname === '/api/coach/live-token') {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      sendJson(req, res, 503, {
        error: 'live_token_unavailable',
        message: 'GEMINI_API_KEY is not configured on the server.',
      });
      return true;
    }

    try {
      const { GoogleGenAI } = require('@google/genai');
      const client = new GoogleGenAI({
        apiKey,
        httpOptions: { apiVersion: 'v1alpha' },
      });

      const now = Date.now();
      const newSessionExpireTime = new Date(now + 2 * 60 * 1000).toISOString();
      const expireTime = new Date(now + 3 * 60 * 1000).toISOString();
      // Developer API Live models (legacy gemini-2.0-flash-live-001 is retired).
      const liveModel =
        process.env.GEMINI_LIVE_MODEL ||
        'gemini-2.5-flash-native-audio-preview-12-2025';
      const systemInstruction =
        'You are a friendly fitness coach in a live voice+camera session. ' +
        'Always reply out loud with short spoken answers. ' +
        'Watch the camera feed and comment on form when the user asks or when you see an exercise. ' +
        'If form looks okay, say so clearly; if not, give one concrete correction. ' +
        'Keep each reply under two sentences.';

      const tokenRes = await client.authTokens.create({
        config: {
          uses: 1,
          newSessionExpireTime,
          expireTime,
          liveConnectConstraints: {
            model: liveModel,
            config: {
              responseModalities: ['AUDIO'],
              systemInstruction,
              inputAudioTranscription: {},
              outputAudioTranscription: {},
            },
          },
          lockAdditionalFields: [],
          httpOptions: { apiVersion: 'v1alpha' },
        },
      });

      const token =
        (typeof tokenRes?.name === 'string' && tokenRes.name) ||
        (typeof tokenRes?.token === 'string' && tokenRes.token) ||
        null;

      if (!token) {
        console.error('[coach/live-token] unexpected token response:', tokenRes);
        sendJson(req, res, 500, { error: 'live_token_failed' });
        return true;
      }

      console.log(
        JSON.stringify({
          event: 'live_token_issued',
          uid,
          expiresAt: expireTime,
          newSessionExpireTime,
        })
      );

      sendJson(req, res, 200, { token, expiresAt: expireTime });
      return true;
    } catch (err) {
      console.error('[coach/live-token] error:', err?.stack || err);
      sendJson(req, res, 500, {
        error: 'live_token_failed',
        message: err?.message || 'Could not create ephemeral token.',
      });
      return true;
    }
  }

  sendJson(req, res, 404, { error: 'not_found' });
  return true;
}

// Plain HTTP server — responds to simple requests (Cloud Run health checks,
// browser, etc). Real WebSocket connections are "upgraded" from this same
// server.
const server = http.createServer(async (req, res) => {
  // CORS preflight for all /api/* routes (and any other OPTIONS).
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(req));
    res.end();
    return;
  }

  if (await handleDevicesApi(req, res)) return;
  if (await handleOtaApi(req, res)) return;
  if (await handleCoachApi(req, res)) return;

  res.writeHead(200, {
    'Content-Type': 'text/plain',
    ...corsHeaders(req),
  });
  res.end('The Patch WS Server is running\n');
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

console.log(`\nThe Patch WS Server running on port ${PORT}\n`);

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
    flushChunk(deviceId, buf).catch(err => {
      console.error(`[STORAGE ERROR] device=${deviceId} | ${err.message}`);
      // TODO: no retry/local persistence for now (conscious decision,
      // see pipeline proposal) — if the flush fails, that chunk is lost.
    });
    chunkBuffers.delete(deviceId);
  }
}

async function flushChunk(deviceId, buf) {
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

  const { location } = await storageProvider.saveChunk(path, payload);
  console.log(`[STORAGE] device=${deviceId} | chunk written → ${location} | channels=${channel_labels.join(',')} | samples/ch=${data[0]?.length ?? 0}`);
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

      // ── Webclient: local mode, no login (only if the SERVER is in
      // APP_MODE=local — we do not trust the client to declare this) ─────────
      if (msg.local === true) {
        if (!authProvider.isLocalMode()) {
          console.warn('[AUTH FAIL] Client requested local auth but the server is running in cloud mode');
          ws.send(JSON.stringify({ type: 'auth_error', reason: 'local_auth_not_allowed' }));
          ws.close();
          return;
        }

        const { uid } = await authProvider.verifyToken(null); // local: always fixed dev uid

        clearTimeout(authTimeout);
        ws.authenticated = true;
        ws.role          = 'webclient';
        ws.uid           = uid;
        ws.deviceMac     = (msg.deviceMac ?? '').replace(/:/g, '').toUpperCase();

        webClients.add(ws);
        console.log(`[AUTH OK] WEBCLIENT (local) | uid=${uid} | deviceMac=${ws.deviceMac} | webclients=${webClients.size}`);
        ws.send(JSON.stringify({ type: 'auth_ok', role: 'webclient', uid }));
        return;
      }

      // ── Webclient: real session token (Firebase or other provider) ────────
      if (msg.token) {
        try {
          const result = await authProvider.verifyToken(msg.token);
          if (!result) throw new Error('token rejected by auth provider');
          const { uid } = result;

          clearTimeout(authTimeout);
          ws.authenticated = true;
          ws.role          = 'webclient';
          ws.uid           = uid;
          // Normalize MAC the same way as devices (no colons, uppercase)
          ws.deviceMac     = (msg.deviceMac ?? '').replace(/:/g, '').toUpperCase();

          webClients.add(ws);
          console.log(`[AUTH OK] WEBCLIENT | uid=${uid} | deviceMac=${ws.deviceMac} | webclients=${webClients.size}`);
          ws.send(JSON.stringify({ type: 'auth_ok', role: 'webclient', uid }));

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
