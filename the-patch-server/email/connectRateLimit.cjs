'use strict';
/**
 * In-memory connect attempt limiter (per uid, rolling window).
 * Process-local — fine for single Cloud Run instance during testing.
 */
const { CONNECT_RATE_LIMIT } = require('./config.cjs');

/** @type {Map<string, number[]>} */
const attemptsByUid = new Map();

/**
 * @param {string} uid
 * @param {number} [now]
 * @returns {{ allowed: boolean, remaining: number }}
 */
function checkConnectRateLimit(uid, now = Date.now()) {
  const windowMs = CONNECT_RATE_LIMIT.windowMs;
  const max = CONNECT_RATE_LIMIT.maxAttempts;
  const key = String(uid || '');
  const cutoff = now - windowMs;
  let list = (attemptsByUid.get(key) || []).filter((t) => t > cutoff);
  attemptsByUid.set(key, list);
  const remaining = Math.max(0, max - list.length);
  return { allowed: list.length < max, remaining };
}

/**
 * Record one attempt (call only when the request is accepted into the connect path).
 * @param {string} uid
 * @param {number} [now]
 */
function recordConnectAttempt(uid, now = Date.now()) {
  const key = String(uid || '');
  const windowMs = CONNECT_RATE_LIMIT.windowMs;
  const cutoff = now - windowMs;
  const list = (attemptsByUid.get(key) || []).filter((t) => t > cutoff);
  list.push(now);
  attemptsByUid.set(key, list);
}

/** Test helper — clear all buckets. */
function _resetConnectRateLimit() {
  attemptsByUid.clear();
}

module.exports = {
  checkConnectRateLimit,
  recordConnectAttempt,
  _resetConnectRateLimit,
};
