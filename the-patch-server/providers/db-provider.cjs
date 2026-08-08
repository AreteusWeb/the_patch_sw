/**
 * db-provider.cjs — Database wrapper/adapter for `devices`, `users`, and coach chat.
 *
 * Meeting instruction: do NOT change the database yet — Firestore in the cloud
 * is still used. This wrapper exists so that when migration is decided (e.g.
 * to Postgres/Supabase), only a new `db-provider.<x>.cjs` is added. server.cjs
 * never calls Firestore directly.
 *
 * Coach session lifecycle (create / close / summarize) is orchestrated in
 * server.cjs so db-provider never depends on ai-provider.
 */

const APP_MODE = (process.env.APP_MODE || 'cloud').toLowerCase();

let impl;
if (APP_MODE === 'local') {
  impl = require('./db-provider.local.cjs');
} else {
  impl = require('./db-provider.gcp.cjs');
}

module.exports = {
  getDevicesByOwner: impl.getDevicesByOwner,
  getDeviceByMac: impl.getDeviceByMac,
  createDevice: impl.createDevice,
  deleteDevice: impl.deleteDevice,
  getUser: impl.getUser,
  setUserOtaTriggered: impl.setUserOtaTriggered,
  getActiveSession: impl.getActiveSession,
  getMostRecentSession: impl.getMostRecentSession,
  closeSession: impl.closeSession,
  createSession: impl.createSession,
  getRecentMessages: impl.getRecentMessages,
  getRecentSessionSummaries: impl.getRecentSessionSummaries,
  appendMessage: impl.appendMessage,
  getLatestMetricsSnapshot: impl.getLatestMetricsSnapshot,
  getSessionHistory: impl.getSessionHistory,
  getMetricTrend: impl.getMetricTrend,
  getRecentAlerts: impl.getRecentAlerts,
};
