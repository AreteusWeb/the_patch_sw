'use strict';
/**
 * Verifies the Google OIDC ID token that Cloud Scheduler attaches to
 * POST /internal/email/poll (Authorization: Bearer <ID token>).
 *
 * Accept only when ALL hold:
 *   - EMAIL_POLL_AUDIENCES and EMAIL_POLL_SA are both set (fail closed)
 *   - signature / expiry / issuer valid and `aud` ∈ EMAIL_POLL_AUDIENCES
 *   - email_verified === true
 *   - token email === EMAIL_POLL_SA
 *
 * Never log the token. Callers get a boolean — no failure detail.
 */
const { getEmailPollConfig } = require('./config.cjs');

let oauthClient = null;

/**
 * Default verifier: google-auth-library OAuth2Client.verifyIdToken.
 * @param {string} idToken
 * @param {string[]} audiences
 * @returns {Promise<object>} token payload (throws if invalid)
 */
async function defaultVerifyIdToken(idToken, audiences) {
  if (!oauthClient) {
    const { OAuth2Client } = require('google-auth-library');
    oauthClient = new OAuth2Client();
  }
  const ticket = await oauthClient.verifyIdToken({ idToken, audience: audiences });
  return ticket.getPayload() || {};
}

/**
 * @param {{
 *   verifyIdToken?: (idToken: string, audiences: string[]) => Promise<object>,
 *   getConfig?: () => { audiences: string[], serviceAccount: string },
 * }} [deps]
 * @returns {(req: import('http').IncomingMessage) => Promise<boolean>}
 */
function createPollAuthVerifier(deps = {}) {
  const verifyIdToken = deps.verifyIdToken || defaultVerifyIdToken;
  const getConfig = deps.getConfig || getEmailPollConfig;

  return async function verifyPollRequest(req) {
    const { audiences, serviceAccount } = getConfig();
    if (audiences.length === 0 || !serviceAccount) return false; // fail closed

    const header = req?.headers?.authorization || '';
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return false;

    try {
      const payload = await verifyIdToken(match[1], audiences);
      if (!payload || payload.email_verified !== true) return false;
      if (typeof payload.email !== 'string') return false;
      return payload.email.trim().toLowerCase() === serviceAccount.toLowerCase();
    } catch (_) {
      return false; // invalid signature, expired, wrong audience, etc.
    }
  };
}

module.exports = {
  createPollAuthVerifier,
  defaultVerifyIdToken,
};
