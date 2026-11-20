'use strict';
/**
 * Email poll job (Phase 3). Called by POST /internal/email/poll (Cloud Scheduler)
 * and scripts/poll-email-once.cjs.
 *
 * - Accounts are looked up per uid (EMAIL_MONITOR_UIDS) via direct doc reads —
 *   no collection-group query, so no new Firestore index.
 * - Each account is locked with a transaction (lockUntil/lockToken) so two runs
 *   never process the same account.
 * - ALL work finishes before runEmailPoll resolves (Cloud Run may throttle CPU
 *   after the HTTP response is sent).
 *
 * Logs: event, uid, counts, error codes only. Never passwords, tokens,
 * subjects, or senders.
 */
const crypto = require('crypto');
const {
  POLL_LIMITS,
  isEmailMonitorUidAllowed,
  resolveEmailProvider,
} = require('./config.cjs');
const { matchKeywords } = require('./keywordMatcher.cjs');

function logPoll(event, fields) {
  console.log(
    JSON.stringify({ event, timestamp: new Date().toISOString(), ...fields })
  );
}

function codedError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

/** Minutes to wait after the nth consecutive failure: 5, 10, 20, 40, 60, 60… */
function backoffMinutes(consecutiveFailures, limits = POLL_LIMITS) {
  const n = Math.max(1, Number(consecutiveFailures) || 1);
  return Math.min(limits.backoffMaxMin, limits.backoffBaseMin * 2 ** (n - 1));
}

/**
 * status "ok" → yes. "error" → only once nextCheckAt has passed.
 * "auth_failed" (and anything else) → never; the user must reconnect.
 */
function isEligible(account, now) {
  if (!account) return false;
  if (account.status === 'ok') return true;
  if (account.status === 'error') {
    return typeof account.nextCheckAt !== 'number' || account.nextCheckAt <= now;
  }
  return false;
}

function clip(value, max) {
  return String(value ?? '').slice(0, max);
}

function toMillisOrNull(d) {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
  return null;
}

/**
 * Create alerts for matching messages. Returns nothing; increments stats.alerts
 * for every alert actually created (existing ids are ignored, not errors).
 */
async function writeAlerts({ db, uid, result, keywords, now, limits, stats }) {
  if (!Array.isArray(keywords) || keywords.length === 0) return;

  const all = result.messages || [];
  // Per-run cap: look at the newest N messages only.
  const considered =
    all.length > limits.maxMessagesPerAccount
      ? all.slice(all.length - limits.maxMessagesPerAccount)
      : all;

  const matches = [];
  for (const m of considered) {
    const hits = matchKeywords(m, keywords);
    if (hits.length > 0) matches.push({ m, hits });
  }
  if (matches.length === 0) return;

  const createdAt = now;
  const expiresAt = new Date(now + limits.alertTtlMs);
  const validity = result.uidValidity ?? 0;

  const create = async (id, data) => {
    try {
      const created = await db.createEmailAlert(uid, id, data);
      if (created) stats.alerts += 1;
    } catch (_) {
      throw codedError('ALERT_WRITE_FAILED');
    }
  };

  if (matches.length > limits.maxAlertsPerAccount) {
    const kw = [...new Set(matches.flatMap((x) => x.hits))].slice(0, 20);
    await create(`summary_${validity}_${result.lastUid ?? 0}`, {
      kind: 'summary',
      from: '',
      subject: `${matches.length} emails match your keywords`,
      date: null,
      matchedKeywords: kw,
      matchCount: matches.length,
      createdAt,
      read: false,
      expiresAt,
    });
    return;
  }

  for (const { m, hits } of matches) {
    await create(`${validity}_${m.uid}`, {
      kind: 'match',
      from: clip(m.from, limits.subjectMaxLen),
      subject: clip(m.subject, limits.subjectMaxLen),
      date: toMillisOrNull(m.date),
      matchedKeywords: hits,
      createdAt,
      read: false,
      expiresAt,
    });
  }
}

/**
 * Process one uid's account. Never throws.
 * @returns {Promise<{ outcome: 'processed'|'error'|'skipped' }>}
 */
async function processAccount(uid, ctx) {
  const { db, fetchNewEnvelopes, decrypt, nowFn, limits, stats } = ctx;

  let account;
  try {
    account = await db.getEmailAccount(uid);
  } catch (_) {
    logPoll('email_poll_account', { uid, outcome: 'error', code: 'ACCOUNT_READ_FAILED' });
    return { outcome: 'error' };
  }
  if (!account || !isEligible(account, nowFn())) return { outcome: 'skipped' };

  const token = crypto.randomUUID();
  let locked;
  try {
    locked = await db.acquireEmailLock(uid, {
      token,
      now: nowFn(),
      lockMs: limits.lockMs,
    });
  } catch (_) {
    logPoll('email_poll_account', { uid, outcome: 'error', code: 'LOCK_FAILED' });
    return { outcome: 'error' };
  }
  if (!locked) {
    logPoll('email_poll_account', { uid, outcome: 'skipped', code: 'LOCKED' });
    return { outcome: 'skipped' };
  }

  const patchLocked = (patch) =>
    db.updateEmailAccountIfLocked(uid, token, {
      ...patch,
      lockUntil: null,
      lockToken: null,
    });

  // State may have changed between the read and the lock.
  if (!isEligible(locked, nowFn())) {
    try {
      await patchLocked({});
    } catch (_) {
      /* lock expires on its own */
    }
    return { outcome: 'skipped' };
  }

  try {
    let pass;
    try {
      pass = decrypt(locked.credEnc);
    } catch (_) {
      // Key rotated / corrupt payload: only a reconnect can fix it.
      throw codedError('AUTH_FAILED', 'DECRYPT_FAILED');
    }
    const provider = resolveEmailProvider(locked.provider);
    if (!provider) throw codedError('AUTH_FAILED', 'INVALID_PROVIDER');

    const conn = {
      host: provider.host,
      port: provider.port,
      user: locked.email,
      pass,
    };
    // Empty mailbox at connect time (lastUid null, uidValidity known) → start
    // from UID 0 so the first mail that arrives is not skipped.
    const savedLastUid =
      locked.lastUid ?? (locked.uidValidity != null ? 0 : null);

    const result = await fetchNewEnvelopes({
      ...conn,
      lastUid: savedLastUid,
      uidValidity: locked.uidValidity ?? null,
    });

    let nextLastUid;
    let nextUidValidity;
    let fetched = 0;

    if (result.uidValidityChanged) {
      // History is meaningless now: pin the cursor to the newest UID, no alerts.
      const fresh = await fetchNewEnvelopes({
        ...conn,
        lastUid: null,
        uidValidity: null,
      });
      nextLastUid = fresh.lastUid ?? null;
      nextUidValidity = fresh.uidValidity ?? result.uidValidity ?? null;
      logPoll('email_poll_uidvalidity_reset', { uid });
    } else {
      fetched = (result.messages || []).length;
      if (fetched > 0) {
        let keywords = [];
        try {
          const settings = await db.getEmailMonitorSettings(uid);
          keywords = Array.isArray(settings?.keywords) ? settings.keywords : [];
        } catch (_) {
          throw codedError('SETTINGS_READ_FAILED');
        }
        await writeAlerts({
          db,
          uid,
          result,
          keywords,
          now: nowFn(),
          limits,
          stats,
        });
      }
      nextLastUid = result.lastUid ?? locked.lastUid ?? null;
      nextUidValidity = result.uidValidity ?? locked.uidValidity ?? null;
    }

    // Cursor moves only AFTER alerts are written (ids are deterministic, so a
    // retry after a failure here cannot duplicate them).
    const written = await patchLocked({
      lastUid: nextLastUid,
      uidValidity: nextUidValidity,
      status: 'ok',
      lastCheckedAt: nowFn(),
      lastError: null,
      consecutiveFailures: 0,
      nextCheckAt: null,
    });
    if (!written) {
      logPoll('email_poll_account', { uid, outcome: 'skipped', code: 'LOCK_LOST' });
      return { outcome: 'skipped' };
    }
    logPoll('email_poll_account', { uid, outcome: 'processed', fetched });
    return { outcome: 'processed' };
  } catch (err) {
    const code = err && err.code;
    const now = nowFn();
    try {
      if (code === 'AUTH_FAILED') {
        // Stop retrying: repeated bad logins can lock the user's mailbox.
        await patchLocked({
          status: 'auth_failed',
          lastError: 'AUTH_FAILED',
          lastCheckedAt: now,
          nextCheckAt: null,
        });
      } else if (code === 'CONNECTION_FAILED' || code === 'TIMEOUT') {
        const failures = (Number(locked.consecutiveFailures) || 0) + 1;
        await patchLocked({
          status: 'error',
          lastError: code,
          lastCheckedAt: now,
          consecutiveFailures: failures,
          nextCheckAt: now + backoffMinutes(failures, limits) * 60 * 1000,
        });
      } else {
        // Our own failure (DB, etc.): keep status/cursor, just free the lock.
        await patchLocked({});
      }
    } catch (_) {
      /* lock expires on its own */
    }
    logPoll('email_poll_account', {
      uid,
      outcome: 'error',
      code:
        code === 'AUTH_FAILED' || code === 'CONNECTION_FAILED' || code === 'TIMEOUT'
          ? code
          : code === 'ALERT_WRITE_FAILED' || code === 'SETTINGS_READ_FAILED'
            ? code
            : 'INTERNAL',
    });
    return { outcome: 'error' };
  }
}

/**
 * Run one poll pass.
 *
 * @param {{
 *   uids: string[],
 *   deps?: {
 *     dbProvider?: object,
 *     fetchNewEnvelopes?: Function,
 *     decrypt?: Function,
 *     now?: () => number,
 *     isUidAllowed?: (uid: string) => boolean,
 *   },
 *   limits?: Partial<typeof POLL_LIMITS>,
 * }} opts
 * @returns {Promise<{ processed: number, alerts: number, errors: number, skipped: number }>}
 */
async function runEmailPoll(opts = {}) {
  const deps = opts.deps || {};
  const db = deps.dbProvider || require('../providers/db-provider.cjs');
  const fetchNewEnvelopes =
    deps.fetchNewEnvelopes || require('./imapClient.cjs').fetchNewEnvelopes;
  const decrypt = deps.decrypt || require('./credentialCrypto.cjs').decrypt;
  const nowFn = deps.now || Date.now;
  const isUidAllowed = deps.isUidAllowed || isEmailMonitorUidAllowed;
  const limits = { ...POLL_LIMITS, ...(opts.limits || {}) };

  const startedAt = nowFn();
  const deadline = startedAt + limits.deadlineMs;
  const stats = { processed: 0, alerts: 0, errors: 0, skipped: 0 };

  const list = [...new Set(Array.isArray(opts.uids) ? opts.uids : [])]
    .filter((u) => typeof u === 'string' && u && isUidAllowed(u))
    .slice(0, limits.maxAccountsPerRun);

  const ctx = { db, fetchNewEnvelopes, decrypt, nowFn, limits, stats };
  let next = 0;

  async function worker() {
    for (;;) {
      if (nowFn() >= deadline) return; // don't start new accounts past deadline
      const i = next++;
      if (i >= list.length) return;
      let outcome = 'error';
      try {
        ({ outcome } = await processAccount(list[i], ctx));
      } catch (_) {
        outcome = 'error';
      }
      if (outcome === 'processed') stats.processed += 1;
      else if (outcome === 'skipped') stats.skipped += 1;
      else stats.errors += 1;
    }
  }

  const workers = Array.from(
    { length: Math.max(1, Math.min(limits.concurrency, list.length || 1)) },
    () => worker()
  );
  await Promise.all(workers);

  // Accounts never started because the deadline hit.
  const notStarted = Math.max(0, list.length - next);
  stats.skipped += notStarted;

  logPoll('email_poll_done', {
    ...stats,
    deadlineHit: notStarted > 0,
    durationMs: nowFn() - startedAt,
  });
  return { ...stats };
}

module.exports = {
  runEmailPoll,
  processAccount,
  backoffMinutes,
  isEligible,
};
