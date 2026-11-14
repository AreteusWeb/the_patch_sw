'use strict';
/**
 * HTTP handlers for /api/email/* (Phase 2 — no poll job).
 * Wired from server.cjs only when EMAIL_MONITOR_ENABLED is true.
 *
 * Never log passwords, subjects, or senders — only uid, event, error codes.
 */
const {
  isEmailMonitorUidAllowed,
  resolveEmailProvider,
} = require('./config.cjs');
const { validateKeywords } = require('./keywordMatcher.cjs');
const {
  checkConnectRateLimit,
  recordConnectAttempt,
} = require('./connectRateLimit.cjs');

function logEmailEvent(event, fields) {
  console.log(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    })
  );
}

function isValidEmail(value) {
  if (typeof value !== 'string') return false;
  const s = value.trim();
  // Practical check — not a full RFC parser.
  return s.length >= 5 && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * @param {{
 *   verifyAuthHeader: (req: any) => Promise<string|null>,
 *   sendJson: (req: any, res: any, status: number, obj: object) => void,
 *   sendJsonBodyError: (req: any, res: any, err: any) => void,
 *   readJsonBody: (req: any) => Promise<object>,
 *   dbProvider: object,
 *   fetchNewEnvelopes?: Function,
 *   encrypt?: Function,
 * }} deps
 */
function createEmailApiHandler(deps) {
  const {
    verifyAuthHeader,
    sendJson,
    sendJsonBodyError,
    readJsonBody,
    dbProvider,
  } = deps;

  const fetchNewEnvelopes =
    deps.fetchNewEnvelopes || require('./imapClient.cjs').fetchNewEnvelopes;
  const encrypt = deps.encrypt || require('./credentialCrypto.cjs').encrypt;

  /**
   * @returns {Promise<boolean>} true if handled
   */
  return async function handleEmailApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!url.pathname.startsWith('/api/email')) return false;

    const uid = await verifyAuthHeader(req);
    if (!uid) {
      sendJson(req, res, 401, { error: 'unauthorized' });
      return true;
    }

    if (!isEmailMonitorUidAllowed(uid)) {
      logEmailEvent('email_api_forbidden', { uid, path: url.pathname });
      sendJson(req, res, 403, { error: 'forbidden' });
      return true;
    }

    // ── POST /api/email/connect ───────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/api/email/connect') {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJsonBodyError(req, res, err);
        return true;
      }

      const rate = checkConnectRateLimit(uid);
      if (!rate.allowed) {
        logEmailEvent('email_connect_rate_limited', { uid });
        sendJson(req, res, 429, {
          error: 'rate_limited',
          message: 'Too many connection attempts. Try again later.',
        });
        return true;
      }
      recordConnectAttempt(uid);

      const provider = resolveEmailProvider(body.provider);
      if (!provider) {
        sendJson(req, res, 400, {
          error: 'invalid_provider',
          message: 'provider must be one of: turbify, yahoo',
        });
        return true;
      }

      const email = typeof body.email === 'string' ? body.email.trim() : '';
      const appPassword =
        typeof body.appPassword === 'string' ? body.appPassword : '';
      if (!isValidEmail(email)) {
        sendJson(req, res, 400, { error: 'invalid_email' });
        return true;
      }
      if (!appPassword || appPassword.length < 4) {
        sendJson(req, res, 400, { error: 'invalid_app_password' });
        return true;
      }

      try {
        const cursor = await fetchNewEnvelopes({
          host: provider.host,
          port: provider.port,
          user: email,
          pass: appPassword,
          lastUid: null,
          uidValidity: null,
        });

        let credEnc;
        try {
          credEnc = encrypt(appPassword);
        } catch (encErr) {
          logEmailEvent('email_connect_encrypt_failed', {
            uid,
            code: 'ENCRYPT_FAILED',
          });
          sendJson(req, res, 500, { error: 'encrypt_failed' });
          return true;
        }

        const now = Date.now();
        const existing = await dbProvider.getEmailAccount(uid);
        const doc = {
          provider: provider.key,
          email,
          credEnc,
          lastUid: cursor.lastUid ?? null,
          uidValidity: cursor.uidValidity ?? null,
          status: 'ok',
          lastCheckedAt: now,
          lastError: null,
          createdAt:
            existing && typeof existing.createdAt === 'number'
              ? existing.createdAt
              : now,
          updatedAt: now,
        };
        await dbProvider.setEmailAccount(uid, doc);

        logEmailEvent('email_connect_ok', {
          uid,
          provider: provider.key,
          lastUid: cursor.lastUid ?? null,
        });
        sendJson(req, res, 200, {
          ok: true,
          provider: provider.key,
          email,
          status: 'ok',
          lastCheckedAt: now,
        });
        return true;
      } catch (err) {
        const code =
          err && err.code && ['AUTH_FAILED', 'CONNECTION_FAILED', 'TIMEOUT'].includes(err.code)
            ? err.code
            : 'CONNECTION_FAILED';
        logEmailEvent('email_connect_failed', { uid, code });
        const status = code === 'AUTH_FAILED' ? 401 : code === 'TIMEOUT' ? 504 : 502;
        sendJson(req, res, status, { error: code });
        return true;
      }
    }

    // ── GET /api/email/status ─────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/email/status') {
      try {
        const account = await dbProvider.getEmailAccount(uid);
        if (!account) {
          sendJson(req, res, 200, { connected: false });
          return true;
        }
        sendJson(req, res, 200, {
          connected: true,
          provider: account.provider ?? null,
          email: account.email ?? null,
          status: account.status ?? null,
          lastCheckedAt: account.lastCheckedAt ?? null,
          lastError: account.lastError ?? null,
        });
        return true;
      } catch (err) {
        logEmailEvent('email_status_failed', { uid, code: 'STATUS_FAILED' });
        sendJson(req, res, 500, { error: 'status_failed' });
        return true;
      }
    }

    // ── GET /api/email/keywords ───────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/api/email/keywords') {
      try {
        const settings = await dbProvider.getEmailMonitorSettings(uid);
        const keywords = Array.isArray(settings?.keywords) ? settings.keywords : [];
        sendJson(req, res, 200, { keywords });
        return true;
      } catch (err) {
        logEmailEvent('email_keywords_get_failed', { uid });
        sendJson(req, res, 500, { error: 'keywords_failed' });
        return true;
      }
    }

    // ── PUT /api/email/keywords ───────────────────────────────────────────
    if (req.method === 'PUT' && url.pathname === '/api/email/keywords') {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch (err) {
        sendJsonBodyError(req, res, err);
        return true;
      }
      const validated = validateKeywords(body.keywords);
      if (!validated.ok) {
        sendJson(req, res, 400, {
          error: validated.error,
          message: validated.message,
        });
        return true;
      }
      try {
        await dbProvider.setEmailMonitorSettings(uid, {
          keywords: validated.keywords,
          updatedAt: Date.now(),
        });
        logEmailEvent('email_keywords_put', {
          uid,
          count: validated.keywords.length,
        });
        sendJson(req, res, 200, { keywords: validated.keywords });
        return true;
      } catch (err) {
        logEmailEvent('email_keywords_put_failed', { uid });
        sendJson(req, res, 500, { error: 'keywords_failed' });
        return true;
      }
    }

    // ── DELETE /api/email/account ─────────────────────────────────────────
    if (req.method === 'DELETE' && url.pathname === '/api/email/account') {
      try {
        await dbProvider.deleteEmailAccount(uid);
        logEmailEvent('email_account_deleted', { uid });
        sendJson(req, res, 200, { ok: true, deleted: true });
        return true;
      } catch (err) {
        logEmailEvent('email_account_delete_failed', { uid });
        sendJson(req, res, 500, { error: 'delete_failed' });
        return true;
      }
    }

    sendJson(req, res, 404, { error: 'not_found' });
    return true;
  };
}

module.exports = {
  createEmailApiHandler,
  isValidEmail,
};
