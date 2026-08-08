/**
 * appConfig.ts — Single configuration point for app mode.
 *
 * Instead of each file (firebase.ts, useAuth.ts, useWebSocket.ts,
 * DeviceSelectionScreen.tsx, ...) checking `import.meta.env` on its own,
 * everything imports APP_MODE / IS_LOCAL_MODE / WS_URL from here. This
 * allows switching between the cloud scenario (Firebase/GCS) and the
 * local/self-hosted scenario without touching business logic.
 */

export type AppMode = 'cloud' | 'local';

export const APP_MODE: AppMode =
  import.meta.env.VITE_APP_MODE === 'local' ? 'local' : 'cloud';

export const IS_LOCAL_MODE = APP_MODE === 'local';

// DEV_SHOW_ANY_DEVICE — local dev convenience, requested so nobody has to
// register/select a device just to see data flowing. Skips the "My
// Devices" screen and shows whatever device is streaming, straight to the
// UI. Only takes effect in local mode; the backend has the matching flag
// (DEV_SHOW_ANY_DEVICE in the-patch-server/.env) and independently
// enforces the same "local mode only" rule — a client can't turn this on
// against a cloud-mode server just by setting this env var.
export const DEV_SHOW_ANY_DEVICE =
  IS_LOCAL_MODE && import.meta.env.VITE_DEV_SHOW_ANY_DEVICE === 'true';

// ─── The Patch server WebSocket ───────────────────────────────────────────────

// This URL used to be hard-coded inside useWebSocket.ts pointing always at
// production. It can now be overridden with VITE_WS_URL — required for local
// mode (the server runs on your own machine/network).
const DEFAULT_CLOUD_WS_URL = 'wss://chestpad-ws-server-1048900719191.us-central1.run.app/ws';
const DEFAULT_LOCAL_WS_URL = 'ws://localhost:8080/ws';

export const WS_URL: string =
  import.meta.env.VITE_WS_URL ||
  (IS_LOCAL_MODE ? DEFAULT_LOCAL_WS_URL : DEFAULT_CLOUD_WS_URL);

/**
 * HTTP base for the-patch-server REST routes (/api/ota, /api/coach, …).
 * - VITE_API_BASE_OVERRIDE wins when set (any mode).
 * - In Vite DEV, default to local server (node server.cjs on :8080).
 * - Otherwise production Cloud Run.
 */
const DEFAULT_CLOUD_API_BASE =
  'https://chestpad-ws-server-1048900719191.us-central1.run.app';

export const API_BASE =
  import.meta.env.VITE_API_BASE_OVERRIDE ||
  (import.meta.env.DEV ? 'http://localhost:8080' : DEFAULT_CLOUD_API_BASE);

if (!import.meta.env.VITE_WS_URL) {
  // Does not throw — only warns. The production default is documented here
  // (not a secret), but ideally set it via VITE_WS_URL.
  console.warn(
    `[appConfig] VITE_WS_URL is not defined in your .env — using the ` +
    `default for mode "${APP_MODE}": ${WS_URL}`
  );
}
