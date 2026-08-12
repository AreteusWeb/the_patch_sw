/**
 * db-provider.gcp.cjs — Real implementation (Firestore).
 * Reuses the same firebase-admin app as auth-provider.gcp.cjs
 * (avoids initializing it twice).
 *
 * Coach chat lives under:
 *   users/{uid}/coachSessions/{sessionId}
 *   users/{uid}/coachSessions/{sessionId}/messages/{messageId}
 */

const { admin } = require('./auth-provider.gcp.cjs');

const db = admin.firestore();

/** Idle window before an open coach session is closed and a new one starts. */
const COACH_SESSION_IDLE_MS = 45 * 60 * 1000;

function coachSessionsRef(uid) {
  return db.collection('users').doc(uid).collection('coachSessions');
}

function coachMessagesRef(uid, sessionId) {
  return coachSessionsRef(uid).doc(sessionId).collection('messages');
}

async function getDevicesByOwner(uid) {
  const snap = await db.collection('devices').where('ownerUid', '==', uid).get();
  return snap.docs.map(d => d.data());
}

async function getDeviceByMac(mac) {
  const ref = await db.collection('devices').doc(mac).get();
  return ref.exists ? ref.data() : null;
}

async function createDevice(device) {
  await db.collection('devices').doc(device.deviceMac).set(device);
}

async function deleteDevice(mac) {
  await db.collection('devices').doc(mac).delete();
}

async function getUser(uid) {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function setUserOtaTriggered(uid, fields) {
  await db.collection('users').doc(uid).set(fields, { merge: true });
}

/**
 * Returns the active (open + not idle) coach session, or null.
 * Does not create or close sessions — server.cjs owns that orchestration
 * so summaries can be generated via ai-provider before close.
 * @returns {Promise<{ sessionId: string, startedAt: number, lastMessageAt: number, closedAt: null, summary: string|null, metricsAtStart: object|null }|null>}
 */
async function getActiveSession(uid) {
  const now = Date.now();
  const openSnap = await coachSessionsRef(uid).where('closedAt', '==', null).get();
  const openDocs = openSnap.docs.sort((a, b) => {
    const aAt = a.data().lastMessageAt ?? a.data().startedAt ?? 0;
    const bAt = b.data().lastMessageAt ?? b.data().startedAt ?? 0;
    return bAt - aAt;
  });

  if (openDocs.length === 0) return null;

  const doc = openDocs[0];
  const data = doc.data();
  const lastAt = typeof data.lastMessageAt === 'number' ? data.lastMessageAt : data.startedAt;
  if (lastAt == null || now - lastAt > COACH_SESSION_IDLE_MS) return null;

  return {
    sessionId: doc.id,
    startedAt: data.startedAt ?? lastAt,
    lastMessageAt: data.lastMessageAt ?? lastAt,
    closedAt: null,
    summary: data.summary ?? null,
    metricsAtStart: data.metricsAtStart ?? null,
  };
}

/**
 * Most recent coach session for the user (open or closed), by lastMessageAt.
 * @returns {Promise<{ sessionId: string, startedAt: number|null, lastMessageAt: number|null, closedAt: number|null, summary: string|null, metricsAtStart: object|null }|null>}
 */
async function getMostRecentSession(uid) {
  const snap = await coachSessionsRef(uid)
    .orderBy('lastMessageAt', 'desc')
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  const data = doc.data();
  return {
    sessionId: doc.id,
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
  await coachSessionsRef(uid).doc(sessionId).set(
    {
      closedAt: Date.now(),
      summary: summary ?? null,
    },
    { merge: true }
  );
}

/**
 * Create a new open coach session.
 * @param {object|null} metricsAtStart
 * @returns {Promise<{ sessionId: string, startedAt: number, lastMessageAt: number, closedAt: null, summary: null, metricsAtStart: object|null }>}
 */
async function createSession(uid, metricsAtStart = null) {
  const now = Date.now();
  const newRef = coachSessionsRef(uid).doc();
  const payload = {
    startedAt: now,
    lastMessageAt: now,
    closedAt: null,
    summary: null,
    metricsAtStart: metricsAtStart ?? null,
  };
  await newRef.set(payload);
  return { sessionId: newRef.id, ...payload };
}

/**
 * Last N messages for a session, ordered by createdAt ascending.
 * @returns {Promise<Array<{ id: string, role: string, text: string, createdAt: number, metricsSnapshot: object|null, toolCalls: array }>>}
 */
async function getRecentMessages(uid, sessionId, limit = 20) {
  const snap = await coachMessagesRef(uid, sessionId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .reverse();
}

/**
 * Summaries from previously closed sessions (excludes excludeSessionId).
 * Skips sessions whose summary is still null.
 * @returns {Promise<Array<{ sessionId: string, summary: string, lastMessageAt: number|null, closedAt: number|null }>>}
 */
async function getRecentSessionSummaries(uid, excludeSessionId, limit = 3) {
  // Single-field orderBy only — filter closed/summary in memory to avoid a
  // composite index for closedAt inequality queries.
  const snap = await coachSessionsRef(uid)
    .orderBy('lastMessageAt', 'desc')
    .limit(Math.max(limit * 4, 16))
    .get();

  const out = [];
  for (const doc of snap.docs) {
    if (doc.id === excludeSessionId) continue;
    const data = doc.data();
    if (data.closedAt == null) continue;
    if (data.summary == null || data.summary === '') continue;
    out.push({
      sessionId: doc.id,
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
 * @param {{
 *   role: 'user'|'model',
 *   text: string,
 *   metricsSnapshot?: object|null,
 *   toolCalls?: array,
 *   attachments?: Array<{
 *     type: 'image',
 *     imageUrl: string,
 *     photographerName: string,
 *     photographerProfileUrl: string,
 *   }>,
 * }} msg
 */
async function appendMessage(uid, sessionId, msg) {
  const now = Date.now();
  const sessionRef = coachSessionsRef(uid).doc(sessionId);
  const messageRef = coachMessagesRef(uid, sessionId).doc();

  const payload = {
    role: msg.role,
    text: msg.text,
    createdAt: now,
    metricsSnapshot: msg.metricsSnapshot ?? null,
    toolCalls: Array.isArray(msg.toolCalls) ? msg.toolCalls : [],
    attachments: Array.isArray(msg.attachments) ? msg.attachments : [],
  };

  const batch = db.batch();
  batch.set(messageRef, payload);
  batch.set(sessionRef, { lastMessageAt: now }, { merge: true });
  await batch.commit();

  return { id: messageRef.id, ...payload };
}

/**
 * Latest metricsSnapshot from any coach message that has one (newest first).
 * Never returns waveforms — only the allow-listed metrics object stored on messages.
 * @returns {Promise<object|null>}
 */
async function getLatestMetricsSnapshot(uid) {
  const sessionsSnap = await coachSessionsRef(uid)
    .orderBy('lastMessageAt', 'desc')
    .limit(12)
    .get();

  for (const sessionDoc of sessionsSnap.docs) {
    const msgSnap = await coachMessagesRef(uid, sessionDoc.id)
      .orderBy('createdAt', 'desc')
      .limit(40)
      .get();

    for (const msgDoc of msgSnap.docs) {
      const snap = msgDoc.data().metricsSnapshot;
      if (snap && typeof snap === 'object') return snap;
    }
  }
  return null;
}

/**
 * Closed coach sessions, most recent first.
 * @param {{ limit?: number }} opts
 * @returns {Promise<Array<{ sessionId: string, startedAt: number|null, closedAt: number|null, summary: string|null }>>}
 */
async function getSessionHistory(uid, { limit = 5 } = {}) {
  const snap = await coachSessionsRef(uid)
    .orderBy('lastMessageAt', 'desc')
    .limit(Math.max(limit * 3, 15))
    .get();

  const out = [];
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.closedAt == null) continue;
    out.push({
      sessionId: doc.id,
      startedAt: data.startedAt ?? null,
      closedAt: data.closedAt ?? null,
      summary: data.summary ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
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
 * Cross-session trend from message metricsSnapshots (no waveforms).
 * @param {{ metric: string, days?: number }} opts
 * @returns {Promise<{ metric: string, values: Array<{date: string, value: number}>, average: number|null, direction: 'up'|'down'|'stable' }>}
 */
async function getMetricTrend(uid, { metric, days = 7 } = {}) {
  if (!TREND_METRICS.has(metric)) {
    return { metric, values: [], sampleCount: 0, average: null, direction: 'stable' };
  }

  const since = Date.now() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
  const sessionsSnap = await coachSessionsRef(uid)
    .orderBy('lastMessageAt', 'desc')
    .limit(40)
    .get();

  /** @type {Array<{ date: string, value: number, at: number }>} */
  const points = [];

  for (const sessionDoc of sessionsSnap.docs) {
    const session = sessionDoc.data();
    if ((session.lastMessageAt ?? session.startedAt ?? 0) < since) continue;

    const msgSnap = await coachMessagesRef(uid, sessionDoc.id)
      .orderBy('createdAt', 'desc')
      .limit(80)
      .get();

    for (const msgDoc of msgSnap.docs) {
      const data = msgDoc.data();
      const createdAt = data.createdAt ?? 0;
      if (createdAt < since) continue;
      const snap = data.metricsSnapshot;
      if (!snap || typeof snap !== 'object') continue;
      const raw = snap[metric];
      const value = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(value)) continue;
      points.push({
        at: createdAt,
        date: new Date(createdAt).toISOString().slice(0, 10),
        value,
      });
    }
  }

  points.sort((a, b) => a.at - b.at);

  // One value per day (latest sample that day) — keeps the payload small for the model.
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
 * Collection: top-level `events` (same as src/hooks/useFirestore.ts /
 * saveEventWithVitals). Schema: userId, type, label, severity, timestamp
 * (epoch ms), vitals.
 *
 * NOTE: today this collection is filled mainly by the frontend simulator
 * (src/hooks/useWebSocket.ts → addEvent). Real device streams only call
 * addAlert() (in-memory, not persisted) and do NOT call addEvent(). When a
 * real classifier is wired up, it should write into this same `events`
 * collection so the Coach picks them up with no further changes.
 *
 * @param {{ limit?: number }} opts
 * @returns {Promise<Array<{ type: string, label: string, severity: string, timestamp: number, vitals: object|null }>>}
 */
async function getRecentAlerts(uid, { limit = 10 } = {}) {
  const snap = await db.collection('events')
    .where('userId', '==', uid)
    .orderBy('timestamp', 'desc')
    .limit(Math.max(1, Number(limit) || 10))
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    return {
      type: data.type ?? null,
      label: data.label ?? null,
      severity: data.severity ?? null,
      timestamp: data.timestamp ?? null,
      vitals: data.vitals ?? null,
    };
  });
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
  getLatestMetricsSnapshot,
  getSessionHistory,
  getMetricTrend,
  getRecentAlerts,
};
