/**
 * db-provider.local.cjs — Local implementation (in-memory, no persistence).
 *
 * Used when APP_MODE=local. Data lives only while the process is running —
 * it is lost on restart. This is intentional: for meeting priority #4 (local
 * UI showing channels) persistence is not needed yet. If real local persistence
 * is wanted later, Postgres/SQLite/Supabase would be wired up here.
 *
 * Coach chat mirrors the Firestore layout in memory:
 *   users/{uid}/coachSessions/{sessionId}/messages/{messageId}
 */

const devicesByMac = new Map();
const usersByUid = new Map();

/** @type {Map<string, Map<string, object>>} uid -> sessionId -> session */
const coachSessionsByUid = new Map();
/** @type {Map<string, Map<string, object[]>>} uid -> sessionId -> messages[] */
const coachMessagesByUid = new Map();

const COACH_SESSION_IDLE_MS = 45 * 60 * 1000;

let localIdCounter = 0;
function nextLocalId(prefix) {
  localIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${localIdCounter}`;
}

function sessionsFor(uid) {
  if (!coachSessionsByUid.has(uid)) coachSessionsByUid.set(uid, new Map());
  return coachSessionsByUid.get(uid);
}

function messagesFor(uid, sessionId) {
  if (!coachMessagesByUid.has(uid)) coachMessagesByUid.set(uid, new Map());
  const bySession = coachMessagesByUid.get(uid);
  if (!bySession.has(sessionId)) bySession.set(sessionId, []);
  return bySession.get(sessionId);
}

async function getDevicesByOwner(uid) {
  return [...devicesByMac.values()].filter(d => d.ownerUid === uid);
}

async function getDeviceByMac(mac) {
  return devicesByMac.get(mac) ?? null;
}

async function createDevice(device) {
  devicesByMac.set(device.deviceMac, device);
}

async function deleteDevice(mac) {
  devicesByMac.delete(mac);
}

async function getUser(uid) {
  return usersByUid.get(uid) ?? null;
}

async function setUserOtaTriggered(uid, fields) {
  usersByUid.set(uid, { ...(usersByUid.get(uid) || {}), ...fields });
}

/**
 * Returns the active (open + not idle) coach session, or null.
 * Does not create or close sessions — server.cjs owns that orchestration.
 */
async function getActiveSession(uid) {
  const now = Date.now();
  const open = [...sessionsFor(uid).entries()]
    .filter(([, s]) => s.closedAt == null)
    .sort((a, b) => (b[1].lastMessageAt ?? 0) - (a[1].lastMessageAt ?? 0));

  if (open.length === 0) return null;

  const [sessionId, data] = open[0];
  const lastAt = typeof data.lastMessageAt === 'number' ? data.lastMessageAt : data.startedAt;
  if (lastAt == null || now - lastAt > COACH_SESSION_IDLE_MS) return null;

  return {
    sessionId,
    startedAt: data.startedAt ?? lastAt,
    lastMessageAt: data.lastMessageAt ?? lastAt,
    closedAt: null,
    summary: data.summary ?? null,
    metricsAtStart: data.metricsAtStart ?? null,
  };
}

/**
 * Most recent coach session for the user (open or closed), by lastMessageAt.
 */
async function getMostRecentSession(uid) {
  const all = [...sessionsFor(uid).entries()]
    .sort((a, b) => (b[1].lastMessageAt ?? 0) - (a[1].lastMessageAt ?? 0));

  if (all.length === 0) return null;
  const [sessionId, data] = all[0];
  return {
    sessionId,
    startedAt: data.startedAt ?? null,
    lastMessageAt: data.lastMessageAt ?? null,
    closedAt: data.closedAt ?? null,
    summary: data.summary ?? null,
    metricsAtStart: data.metricsAtStart ?? null,
  };
}

/**
 * Close a coach session and persist its summary.
 */
async function closeSession(uid, sessionId, summary) {
  const sessions = sessionsFor(uid);
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`coach_session_not_found:${sessionId}`);
  }
  sessions.set(sessionId, {
    ...session,
    closedAt: Date.now(),
    summary: summary ?? null,
  });
}

/**
 * Create a new open coach session.
 */
async function createSession(uid, metricsAtStart = null) {
  const now = Date.now();
  const sessionId = nextLocalId('coach');
  const payload = {
    startedAt: now,
    lastMessageAt: now,
    closedAt: null,
    summary: null,
    metricsAtStart: metricsAtStart ?? null,
  };
  sessionsFor(uid).set(sessionId, payload);
  return { sessionId, ...payload };
}

/**
 * Last N messages for a session, ordered by createdAt ascending.
 */
async function getRecentMessages(uid, sessionId, limit = 20) {
  const msgs = messagesFor(uid, sessionId)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  return msgs.slice(-limit).map(m => ({ ...m }));
}

/**
 * Summaries from previously closed sessions (excludes excludeSessionId).
 * Skips sessions whose summary is still null.
 */
async function getRecentSessionSummaries(uid, excludeSessionId, limit = 3) {
  const sessions = sessionsFor(uid);
  const closed = [...sessions.entries()]
    .filter(([id, s]) => id !== excludeSessionId && s.closedAt != null)
    .sort((a, b) => (b[1].closedAt ?? 0) - (a[1].closedAt ?? 0));

  const out = [];
  for (const [sessionId, data] of closed) {
    if (data.summary == null || data.summary === '') continue;
    out.push({
      sessionId,
      summary: data.summary,
      lastMessageAt: data.lastMessageAt ?? null,
      closedAt: data.closedAt ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Appends a message and bumps the session's lastMessageAt.
 * attachments may include { type: 'image', ... } and/or { type: 'video', ... }.
 */
async function appendMessage(uid, sessionId, msg) {
  const now = Date.now();
  const sessions = sessionsFor(uid);
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error(`coach_session_not_found:${sessionId}`);
  }

  const payload = {
    id: nextLocalId('msg'),
    role: msg.role,
    text: msg.text,
    createdAt: now,
    metricsSnapshot: msg.metricsSnapshot ?? null,
    toolCalls: Array.isArray(msg.toolCalls) ? msg.toolCalls : [],
    attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
  };

  messagesFor(uid, sessionId).push(payload);
  sessions.set(sessionId, { ...session, lastMessageAt: now });
  return { ...payload };
}

/**
 * Append a Voice & Video recording metadata entry on a coach session.
 * @param {string} uid
 * @param {string} sessionId
 * @param {{ storagePath: string, uploadedAt: number, durationSeconds: number }} recording
 */
async function appendCoachRecording(uid, sessionId, recording) {
  const sessions = sessionsFor(uid);
  let session = sessions.get(sessionId);
  const entry = {
    storagePath: recording.storagePath,
    uploadedAt: recording.uploadedAt,
    durationSeconds: recording.durationSeconds,
  };

  if (!session) {
    const now = Date.now();
    session = {
      sessionId,
      startedAt: now,
      lastMessageAt: now,
      closedAt: null,
      summary: null,
      metricsAtStart: null,
      source: 'live_voice_video',
      recordings: [entry],
    };
    sessions.set(sessionId, session);
    return entry;
  }

  const recordings = Array.isArray(session.recordings)
    ? [...session.recordings, entry]
    : [entry];
  sessions.set(sessionId, {
    ...session,
    recordings,
    lastMessageAt: Date.now(),
  });
  return entry;
}

/**
 * Latest metricsSnapshot from any coach message that has one (newest first).
 */
async function getLatestMetricsSnapshot(uid) {
  const sessions = [...sessionsFor(uid).entries()]
    .sort((a, b) => (b[1].lastMessageAt ?? 0) - (a[1].lastMessageAt ?? 0));

  for (const [sessionId] of sessions) {
    const msgs = messagesFor(uid, sessionId)
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt);
    for (const msg of msgs) {
      if (msg.metricsSnapshot && typeof msg.metricsSnapshot === 'object') {
        return { ...msg.metricsSnapshot };
      }
    }
  }
  return null;
}

/**
 * Closed coach sessions, most recent first.
 */
async function getSessionHistory(uid, { limit = 5 } = {}) {
  const closed = [...sessionsFor(uid).entries()]
    .filter(([, s]) => s.closedAt != null)
    .sort((a, b) => (b[1].closedAt ?? 0) - (a[1].closedAt ?? 0));

  return closed.slice(0, limit).map(([sessionId, data]) => ({
    sessionId,
    startedAt: data.startedAt ?? null,
    closedAt: data.closedAt ?? null,
    summary: data.summary ?? null,
  }));
}

const TREND_METRICS = new Set(['heartRate', 'hrvProxyMs', 'recoveryScore', 'spo2']);

function trendDirection(values) {
  if (values.length < 2) return 'stable';
  const first = values[0].value;
  const last = values[values.length - 1].value;
  const span = Math.max(Math.abs(first), Math.abs(last), 1);
  const delta = last - first;
  if (Math.abs(delta) / span < 0.05) return 'stable';
  return delta > 0 ? 'up' : 'down';
}

/**
 * Cross-session trend from in-memory metricsSnapshots (no waveforms).
 */
async function getMetricTrend(uid, { metric, days = 7 } = {}) {
  if (!TREND_METRICS.has(metric)) {
    return { metric, values: [], sampleCount: 0, average: null, direction: 'stable' };
  }

  const since = Date.now() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
  const points = [];

  for (const [sessionId] of sessionsFor(uid).entries()) {
    for (const msg of messagesFor(uid, sessionId)) {
      if ((msg.createdAt ?? 0) < since) continue;
      const snap = msg.metricsSnapshot;
      if (!snap || typeof snap !== 'object') continue;
      const raw = snap[metric];
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) continue;
      points.push({
        at: msg.createdAt,
        date: new Date(msg.createdAt).toISOString().slice(0, 10),
        value,
      });
    }
  }

  points.sort((a, b) => a.at - b.at);
  const byDay = new Map();
  for (const p of points) byDay.set(p.date, { date: p.date, value: p.value });
  const values = [...byDay.values()];
  const average = values.length
    ? Math.round((values.reduce((s, v) => s + v.value, 0) / values.length) * 100) / 100
    : null;

  return {
    metric,
    values,
    sampleCount: values.length,
    average,
    direction: trendDirection(values),
  };
}

/**
 * Recent clinical events for the coach tools.
 *
 * In local mode there is no Firestore `events` collection — frontend
 * saveEventWithVitals is a no-op when VITE_APP_MODE=local — so this always
 * returns []. Same collection/schema is used in cloud (see db-provider.gcp).
 *
 * NOTE: even in cloud, `events` is filled mainly by the simulator today
 * (useWebSocket → addEvent). Real device streams only call addAlert()
 * (not persisted). A future classifier should write to `events`.
 */
async function getRecentAlerts(_uid, { limit: _limit = 10 } = {}) {
  return [];
}

module.exports = {
  getDevicesByOwner,
  getDeviceByMac,
  createDevice,
  deleteDevice,
  getUser,
  setUserOtaTriggered,
  getActiveSession,
  getMostRecentSession,
  closeSession,
  createSession,
  getRecentMessages,
  getRecentSessionSummaries,
  appendMessage,
  appendCoachRecording,
  getLatestMetricsSnapshot,
  getSessionHistory,
  getMetricTrend,
  getRecentAlerts,
};
