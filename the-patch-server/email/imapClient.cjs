'use strict';
/**
 * Read-only IMAP envelope fetch (no body, no attachments).
 * Reference: scripts/test-yahoo-imap.cjs (imapflow + Yahoo/Turbify).
 *
 * Never log passwords, subjects, or full senders — only uids / counts.
 */
const { ImapFlow } = require('imapflow');
const { IMAP_TIMEOUT_MS } = require('./config.cjs');

/**
 * @param {'AUTH_FAILED'|'CONNECTION_FAILED'|'TIMEOUT'} code
 * @param {unknown} cause
 */
function emailImapError(code, cause) {
  const err = new Error(
    cause && typeof cause === 'object' && 'message' in cause
      ? String(/** @type {{ message?: string }} */ (cause).message || code)
      : String(cause || code)
  );
  err.code = code;
  if (cause && typeof cause === 'object') err.cause = cause;
  return err;
}

function classifyImapError(err) {
  if (err && err.code && ['AUTH_FAILED', 'CONNECTION_FAILED', 'TIMEOUT'].includes(err.code)) {
    return err;
  }
  const msg = String(err?.message || err || '').toLowerCase();
  const authHint =
    err?.authenticationFailed === true ||
    err?.responseText === 'AUTHENTICATIONFAILED' ||
    /auth|login|credential|invalid credentials|authentication/i.test(msg);
  if (authHint) return emailImapError('AUTH_FAILED', err);

  const timeoutHint =
    err?.code === 'ETIMEOUT' ||
    err?.code === 'ETIMEDOUT' ||
    err?.code === 'TIMEOUT' ||
    /timeout|timed out/i.test(msg);
  if (timeoutHint) return emailImapError('TIMEOUT', err);

  return emailImapError('CONNECTION_FAILED', err);
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(emailImapError('TIMEOUT', new Error(`${label} timed out after ${ms}ms`)));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Format envelope from[] for matching — not for logging. */
function formatFrom(fromArr) {
  if (!Array.isArray(fromArr) || fromArr.length === 0) return '';
  return fromArr
    .map((a) => {
      if (!a || typeof a !== 'object') return '';
      if (a.name && a.address) return `${a.name} <${a.address}>`;
      return a.address || a.name || '';
    })
    .filter(Boolean)
    .join(', ');
}

/**
 * Open INBOX read-only and return new envelopes since lastUid.
 *
 * @param {{
 *   host: string,
 *   user: string,
 *   pass: string,
 *   lastUid?: number|null,
 *   uidValidity?: number|string|null,
 *   port?: number,
 *   timeoutMs?: number,
 * }} opts
 * @returns {Promise<{
 *   messages: Array<{ uid: number, from: string, subject: string, date: Date|null }>,
 *   lastUid: number|null,
 *   uidValidity: number|null,
 *   uidValidityChanged?: boolean,
 * }>}
 */
async function fetchNewEnvelopes(opts) {
  const host = String(opts?.host || '').trim();
  const user = String(opts?.user || '').trim();
  const pass = opts?.pass;
  if (!host || !user || pass == null || pass === '') {
    throw emailImapError('CONNECTION_FAILED', new Error('host, user, and pass are required'));
  }

  const timeoutMs = Math.max(1000, Number(opts.timeoutMs) || IMAP_TIMEOUT_MS);
  const port = Number(opts.port) || 993;
  const savedLastUid =
    opts.lastUid == null || opts.lastUid === ''
      ? null
      : Number(opts.lastUid);
  const savedUidValidity =
    opts.uidValidity == null || opts.uidValidity === ''
      ? null
      : Number(opts.uidValidity);

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass },
    logger: false,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
  });

  let lock = null;
  try {
    await withTimeout(client.connect(), timeoutMs, 'IMAP connect');

    lock = await withTimeout(
      client.getMailboxLock('INBOX', { readOnly: true }),
      timeoutMs,
      'IMAP mailbox lock'
    );

    const uidValidityRaw = client.mailbox?.uidValidity;
    const uidValidity =
      uidValidityRaw == null ? null : Number(uidValidityRaw);
    const exists = Number(client.mailbox?.exists) || 0;

    // UIDVALIDITY changed — caller decides whether to reset cursor.
    if (
      savedUidValidity != null &&
      Number.isFinite(savedUidValidity) &&
      uidValidity != null &&
      Number.isFinite(uidValidity) &&
      savedUidValidity !== uidValidity
    ) {
      console.log(
        JSON.stringify({
          event: 'email_imap_uidvalidity_changed',
          exists,
          // never log subjects/senders/passwords
        })
      );
      return {
        messages: [],
        lastUid: savedLastUid != null && Number.isFinite(savedLastUid) ? savedLastUid : null,
        uidValidity,
        uidValidityChanged: true,
      };
    }

    // Empty mailbox
    if (exists === 0) {
      return {
        messages: [],
        lastUid: savedLastUid != null && Number.isFinite(savedLastUid) ? savedLastUid : null,
        uidValidity,
      };
    }

    // First run: do not pull history — only pin lastUid to the newest UID.
    if (savedLastUid == null || !Number.isFinite(savedLastUid)) {
      let maxUid = null;
      await withTimeout(
        (async () => {
          // Sequence "*" = last message only (envelope not needed for cursor).
          for await (const msg of client.fetch('*', { uid: true })) {
            maxUid = typeof msg.uid === 'number' ? msg.uid : Number(msg.uid);
          }
        })(),
        timeoutMs,
        'IMAP fetch max uid'
      );
      console.log(
        JSON.stringify({
          event: 'email_imap_cursor_init',
          exists,
          lastUid: maxUid,
        })
      );
      return {
        messages: [],
        lastUid: maxUid != null && Number.isFinite(maxUid) ? maxUid : null,
        uidValidity,
      };
    }

    const fromUid = savedLastUid + 1;
    const messages = [];
    let maxSeen = savedLastUid;

    await withTimeout(
      (async () => {
        // UID range: only envelopes (no source / body / attachments).
        for await (const msg of client.fetch(
          `${fromUid}:*`,
          { envelope: true, uid: true },
          { uid: true }
        )) {
          const uid = typeof msg.uid === 'number' ? msg.uid : Number(msg.uid);
          if (!Number.isFinite(uid) || uid <= savedLastUid) continue;
          const env = msg.envelope || {};
          messages.push({
            uid,
            from: formatFrom(env.from),
            subject: typeof env.subject === 'string' ? env.subject : '',
            date: env.date instanceof Date ? env.date : env.date ? new Date(env.date) : null,
          });
          if (uid > maxSeen) maxSeen = uid;
        }
      })(),
      timeoutMs,
      'IMAP fetch envelopes'
    );

    console.log(
      JSON.stringify({
        event: 'email_imap_fetch',
        fetched: messages.length,
        lastUid: maxSeen,
      })
    );

    return {
      messages,
      lastUid: maxSeen,
      uidValidity,
    };
  } catch (err) {
    throw classifyImapError(err);
  } finally {
    try {
      if (lock) lock.release();
    } catch (_) {
      /* ignore */
    }
    try {
      await client.logout();
    } catch (_) {
      try {
        client.close();
      } catch (__) {
        /* ignore */
      }
    }
  }
}

module.exports = {
  fetchNewEnvelopes,
  classifyImapError,
  emailImapError,
  formatFrom,
};
