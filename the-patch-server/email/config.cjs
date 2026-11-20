'use strict';
/**
 * Email monitor module config.
 * EMAIL_MONITOR_ENABLED defaults off — server.cjs must not load api routes unless true.
 */

const EMAIL_MONITOR_ENABLED =
  String(process.env.EMAIL_MONITOR_ENABLED || '').trim().toLowerCase() === 'true';

/** Comma-separated Firebase uids allowed while testing. Empty → nobody. */
const EMAIL_MONITOR_UIDS = new Set(
  String(process.env.EMAIL_MONITOR_UIDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

/** IMAP connect + operation budget (ms). */
const IMAP_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.EMAIL_IMAP_TIMEOUT_MS || '15000', 10) || 15000
);

/**
 * Fixed provider → IMAP host allowlist. Clients send provider key only — never a free host.
 * turbify/yahoo both use Yahoo's IMAP endpoint today.
 */
const EMAIL_PROVIDERS = Object.freeze({
  turbify: Object.freeze({ host: 'imap.mail.yahoo.com', port: 993 }),
  yahoo: Object.freeze({ host: 'imap.mail.yahoo.com', port: 993 }),
});

const CONNECT_RATE_LIMIT = Object.freeze({
  maxAttempts: 5,
  windowMs: 60 * 60 * 1000,
});

const KEYWORD_LIMITS = Object.freeze({
  maxCount: 20,
  minLen: 2,
  maxLen: 50,
});

/** Phase 3 poll job limits (Cloud Scheduler → POST /internal/email/poll). */
const POLL_LIMITS = Object.freeze({
  concurrency: 5,
  maxAccountsPerRun: 50,
  /** Stop starting new accounts after this (ms); in-flight accounts finish. */
  deadlineMs: 50 * 1000,
  lockMs: 2 * 60 * 1000,
  maxMessagesPerAccount: 200,
  maxAlertsPerAccount: 20,
  alertTtlMs: 30 * 24 * 60 * 60 * 1000,
  subjectMaxLen: 200,
  /** Backoff minutes after consecutive CONNECTION_FAILED / TIMEOUT. */
  backoffBaseMin: 5,
  backoffMaxMin: 60,
});

/**
 * OIDC verification settings for the internal poll endpoint.
 * Read at call time (not module load) so tests / env changes are honored.
 * Missing either value → caller must reject everything (fail closed).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ audiences: string[], serviceAccount: string }}
 */
function getEmailPollConfig(env = process.env) {
  const audiences = String(env.EMAIL_POLL_AUDIENCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const serviceAccount = String(env.EMAIL_POLL_SA || '').trim();
  return { audiences, serviceAccount };
}

function isEmailMonitorUidAllowed(uid) {
  if (!uid) return false;
  return EMAIL_MONITOR_UIDS.has(String(uid));
}

function resolveEmailProvider(providerKey) {
  const key = String(providerKey || '')
    .trim()
    .toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(EMAIL_PROVIDERS, key)) return null;
  return { key, ...EMAIL_PROVIDERS[key] };
}

module.exports = {
  EMAIL_MONITOR_ENABLED,
  EMAIL_MONITOR_UIDS,
  IMAP_TIMEOUT_MS,
  EMAIL_PROVIDERS,
  CONNECT_RATE_LIMIT,
  KEYWORD_LIMITS,
  POLL_LIMITS,
  getEmailPollConfig,
  isEmailMonitorUidAllowed,
  resolveEmailProvider,
};
