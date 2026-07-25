/**
 * auth-provider.local.cjs — Local implementation (no Firebase).
 *
 * Used when APP_MODE=local. Does not validate any token because local mode
 * has no login yet (see meeting priority #4: the desktop UI must work locally
 * without depending on Firebase/GCS).
 *
 * All connections are identified with a fixed development uid.
 * This is intentional and must ONLY be used in local development — server.cjs
 * already ensures the "local" handshake is not accepted if APP_MODE !== 'local'.
 */

const LOCAL_DEV_UID = 'local-dev-user';

async function verifyToken(_token) {
  return { uid: LOCAL_DEV_UID };
}

module.exports = { verifyToken, LOCAL_DEV_UID };
