/**
 * auth-provider.gcp.cjs — Real implementation (Firebase Admin).
 * Only loaded when APP_MODE=cloud (or undefined). This is the only backend
 * file that knows Firebase exists.
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;

  // No hidden default: if the variable is missing, fail with a clear message
  // instead of silently connecting to the real Areteus project.
  if (!projectId) {
    throw new Error(
      '[auth-provider.gcp] Missing environment variable GOOGLE_CLOUD_PROJECT. ' +
      'Set it in your .env (see .env.example) or use APP_MODE=local to run without Firebase.'
    );
  }

  // On Cloud Run credentials are obtained automatically from the environment;
  // no service account key is needed.
  admin.initializeApp({ projectId });
}

/**
 * Verifies a Firebase ID Token.
 * @returns {Promise<{uid: string} | null>}
 */
async function verifyToken(token) {
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { uid: decoded.uid };
  } catch (err) {
    console.warn(`[auth-provider.gcp] Invalid token: ${err.message}`);
    return null;
  }
}

module.exports = { verifyToken, admin };
