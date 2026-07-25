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

// ─── ChestPad server WebSocket ───────────────────────────────────────────────

// This URL used to be hard-coded inside useWebSocket.ts pointing always at
// production. It can now be overridden with VITE_WS_URL — required for local
// mode (the server runs on your own machine/network).
const DEFAULT_CLOUD_WS_URL = 'wss://chestpad-ws-server-1048900719191.us-central1.run.app/ws';
const DEFAULT_LOCAL_WS_URL = 'ws://localhost:8080/ws';

export const WS_URL: string =
  import.meta.env.VITE_WS_URL ||
  (IS_LOCAL_MODE ? DEFAULT_LOCAL_WS_URL : DEFAULT_CLOUD_WS_URL);

if (!import.meta.env.VITE_WS_URL) {
  // Does not throw — only warns. The production default is documented here
  // (not a secret), but ideally set it via VITE_WS_URL.
  console.warn(
    `[appConfig] VITE_WS_URL is not defined in your .env — using the ` +
    `default for mode "${APP_MODE}": ${WS_URL}`
  );
}
