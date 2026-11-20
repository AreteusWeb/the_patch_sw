'use strict';
/**
 * POST /internal/email/poll — called by Cloud Scheduler with an OIDC ID token.
 * Wired from server.cjs only when EMAIL_MONITOR_ENABLED is true.
 *
 * The Cloud Run service is public, so auth is the OIDC check (pollAuth.cjs):
 * any failure → generic 401, no detail, token never logged.
 * The response is sent only AFTER all polling finished (Cloud Run may throttle
 * CPU once the response is out). Body contains counts only.
 */
const { EMAIL_MONITOR_UIDS } = require('./config.cjs');

const POLL_PATH = '/internal/email/poll';

/**
 * @param {{
 *   sendJson: (req: any, res: any, status: number, obj: object) => void,
 *   verifyPollRequest?: (req: any) => Promise<boolean>,
 *   runEmailPoll?: (opts: { uids: string[] }) => Promise<object>,
 *   getUids?: () => string[],
 * }} deps
 * @returns {(req: any, res: any) => Promise<boolean>} true if handled
 */
function createEmailPollHandler(deps) {
  const { sendJson } = deps;
  const verifyPollRequest =
    deps.verifyPollRequest || require('./pollAuth.cjs').createPollAuthVerifier();
  const runEmailPoll = deps.runEmailPoll || require('./poller.cjs').runEmailPoll;
  const getUids = deps.getUids || (() => [...EMAIL_MONITOR_UIDS]);

  return async function handleEmailPoll(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== POLL_PATH) return false;

    // Auth first, for every method — no information about the route leaks.
    let ok = false;
    try {
      ok = await verifyPollRequest(req);
    } catch (_) {
      ok = false;
    }
    if (!ok) {
      sendJson(req, res, 401, { error: 'unauthorized' });
      return true;
    }

    if (req.method !== 'POST') {
      sendJson(req, res, 405, { error: 'method_not_allowed' });
      return true;
    }

    try {
      const summary = await runEmailPoll({ uids: getUids() });
      sendJson(req, res, 200, {
        processed: summary.processed ?? 0,
        alerts: summary.alerts ?? 0,
        errors: summary.errors ?? 0,
        skipped: summary.skipped ?? 0,
      });
    } catch (_) {
      console.log(JSON.stringify({ event: 'email_poll_failed', code: 'INTERNAL' }));
      sendJson(req, res, 500, { error: 'poll_failed' });
    }
    return true;
  };
}

module.exports = { createEmailPollHandler, POLL_PATH };
