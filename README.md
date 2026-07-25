# Areteus The Patch — Device Web Interface

Real-time monitoring of multi-channel ECG data from wearable chest patches ("The Patch").

**Core capabilities:**
- Real-time WebSocket streaming of 10-channel ECG data
- Live multi-channel visualization with ECG-style grids
- Basic heart rate (BPM), SpO2, and respiration rate estimation
- Real-time audio playback of heart sounds (auscultation)
- Over-the-Air (OTA) firmware updates
- Multi-user support with device ownership

## Project layout

- **Frontend** (`/`, repo root) — Vite + React app.
- **Backend** (`the-patch-server/`) — Node.js WebSocket + HTTP server that receives data from the ESP32 device, relays it live to web clients, and persists 10-second chunks for the AI/preprocessing pipeline.

## Two ways to run this

The app supports a `cloud` mode (Firebase + Google Cloud Storage, used in production) and a `local` mode (no cloud account needed — great for development or self-hosting).

## `.env` vs `.env.example`
Copy `.env.example` → `.env` in each folder and fill in your own values. `.env` is git-ignored and should never be committed or shared

### Run it locally (no account needed)

**Backend:**
```bash
cd the-patch-server
npm install
cp .env.example .env
npm start
# → "The Patch WS Server running on port 8080"
```

**Frontend:**
```bash
npm install
cp .env.example .env
# make sure .env has:
#   VITE_APP_MODE=local
#   VITE_WS_URL=ws://localhost:8080/ws
npm run dev
```

Point your ESP32 (or run `mock/mock-esp32.cjs` to simulate one) at `ws://<your-machine-ip>:8080`, open the app, add the device's MAC on "My Devices", and you should see live channels.

**Optional — skip device registration (local dev only):** you can go straight to the main UI and show whatever device is streaming, without adding or selecting a MAC. This only works in `local` mode; both sides must opt in:

`the-patch-server/.env`:
```dotenv
APP_MODE=local
DEV_SHOW_ANY_DEVICE=true
```

Root `.env`:
```dotenv
VITE_APP_MODE=local
VITE_WS_URL=ws://localhost:8080/ws
VITE_DEV_SHOW_ANY_DEVICE=true
```

Restart the backend and frontend after changing `.env` (Vite may not pick up env changes live). With both flags on, the backend ignores MAC matching for the relay — any connected ESP32 or mock device is shown immediately. Leave either flag off and behavior is unchanged.

## Testing with a real ESP32

You don't need to run anything locally to test with a real device — the ESP32's auth (by MAC) was never tied to Firebase, so this hasn't changed. Pick whichever fits what you're testing:

- **Against production (Cloud Run)** — the simplest option. Leave the ESP32 pointed at the production URL, log in normally with Firebase in the app, add the device's MAC on "My Devices", and it should connect exactly as it always has. Good for confirming a backend deploy didn't break the real-device flow.
- **Fully local** — useful if you don't want to touch production at all while iterating. Make sure your machine and the ESP32 are on the same WiFi network, find your machine's local IP (`ipconfig` on Windows, `ifconfig`/`ip a` on Mac/Linux), point the ESP32 at `ws://<that-ip>:8080` instead of the production URL, and run the backend + frontend in `local` mode as described above. If it doesn't connect, double check the device is actually hitting that IP:port (not still pointed at the old URL) and that your firewall isn't blocking port 8080 on the local network.

### Run it against the cloud (production/staging)

Set `APP_MODE=cloud` on the backend with `GOOGLE_CLOUD_PROJECT` and `GCS_BUCKET_NAME`, and `VITE_APP_MODE=cloud` on the frontend with your `VITE_FIREBASE_*` variables. See `.env.example` in each folder for the full list.

.

