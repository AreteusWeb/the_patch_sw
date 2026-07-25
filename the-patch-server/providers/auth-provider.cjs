/**
 * auth-provider.cjs — Authentication wrapper/adapter.
 *
 * server.cjs (and the rest of the backend) must NEVER import `firebase-admin`
 * directly. It only knows these two functions:
 *
 *   - verifyToken(token) -> Promise<{ uid } | null>
 *   - isLocalMode() -> boolean
 *
 * The real implementation (Firebase or "no auth" in local) is selected here
 * based on APP_MODE. If the auth provider changes tomorrow (e.g. Auth0,
 * Supabase Auth), only add a new `auth-provider.<x>.cjs` file and register
 * it below — the rest of the backend stays untouched.
 */

const APP_MODE = (process.env.APP_MODE || 'cloud').toLowerCase();

let impl;
if (APP_MODE === 'local') {
  impl = require('./auth-provider.local.cjs');
} else {
  impl = require('./auth-provider.gcp.cjs');
}

module.exports = {
  /** Verifies a session token and returns { uid } or null if invalid. */
  verifyToken: impl.verifyToken,
  /** true if the backend is running in local mode (no Firebase). */
  isLocalMode: () => APP_MODE === 'local',
};
