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

### Run it locally (no account needed)

## `.env` vs `.env.example`
Copy `.env.example` → `.env` in each folder and fill in your own values. `.env` is git-ignored and should never be committed or shared.

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

Point your ESP32 (or run in terminal `mock/mock-esp32.cjs` to simulate one) at `ws://<your-machine-ip>:8080`, open the app, add the device's MAC on "My Devices", and you should see live channels.

### Run it against the cloud (production/staging)

Set `APP_MODE=cloud` on the backend with `GOOGLE_CLOUD_PROJECT` and `GCS_BUCKET_NAME`, and `VITE_APP_MODE=cloud` on the frontend with your `VITE_FIREBASE_*` variables. See `.env.example` in each folder for the full list.



