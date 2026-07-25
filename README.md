# Areteus The Patch — Device Web Interface

## Overview

The Areteus platform allows real-time monitoring of multi-channel ECG data from wearable chest patches ("The Patch").

**Core capabilities:**
- Real-time WebSocket streaming of 10-channel ECG data (250 Hz, 25 samples/channel every 100 ms)
- User authentication and device registration (MAC-based)
- Live multi-channel visualization with ECG-style grids
- 60 Hz notch filtering (client-side)
- Basic heart rate (BPM), SpO2, and respiration rate estimation
- Real-time audio playback of heart sounds (auscultation)
- Over-the-Air (OTA) firmware updates
- Multi-user support with device ownership

This project has two moving pieces:
- **Frontend** (`/`, this repo root) — a Vite + React app. Desktop and mobile layouts share the same data hooks (`useWebSocket`, `useAuth`, `useFirestore`, `useStore`).
- **Backend** (`the-patch-server/`) — a Node.js WebSocket + HTTP server that receives raw data from the ESP32 device, relays it live to connected web clients, and persists 10-second chunks for the AI/preprocessing pipeline.

## Architecture: cloud vs. local (provider wrappers)

The project can run in two modes, controlled by a single environment variable (`APP_MODE` on the backend, `VITE_APP_MODE` on the frontend):

| | `cloud` (default) | `local` |
|---|---|---|
| Auth | Firebase Auth (real login) | None — a fixed local dev user is assigned automatically, no login screen |
| Database (devices/users) | Firestore | In-memory (backend) / `localStorage` (frontend) — not persisted across restarts |
| Raw ECG chunk storage | Google Cloud Storage | Local disk (`the-patch-server/local-data/`) |
| Requires GCP/Firebase credentials? | Yes | No |
| Intended for | Production, staging, most clients | Developers, self-hosted/advanced clients, quick iteration |

**Why this matters:** nobody who clones this repo needs an Areteus GCP project, service account, or Firebase config just to see the UI working with a real device on their local network. And if the company later decides to swap Firestore for Postgres/Supabase, or GCS for S3, only the provider files need to change — none of the business logic in `server.cjs`, `useWebSocket.ts`, etc. is aware of which backend it's actually talking to.

This is implemented as a **wrapper/adapter pattern** (a.k.a. ports & adapters / hexagonal architecture):

```
the-patch-server/
  server.cjs                        <- only calls generic functions below
  providers/
    auth-provider.cjs                <- selector (reads APP_MODE)
    auth-provider.gcp.cjs            <- real Firebase Admin implementation
    auth-provider.local.cjs          <- no-op / fixed dev user
    storage-provider.cjs             <- selector
    storage-provider.gcp.cjs         <- real GCS implementation
    storage-provider.local.cjs       <- writes JSON chunks to disk
    db-provider.cjs                  <- selector
    db-provider.gcp.cjs              <- real Firestore implementation (devices/users)
    db-provider.local.cjs            <- in-memory Map implementation
```

On the frontend, the equivalent single source of truth is `src/lib/appConfig.ts` (exports `APP_MODE`, `IS_LOCAL_MODE`, `WS_URL`), consumed by `src/lib/firebase.ts`, `src/hooks/useAuth.ts`, `src/hooks/useFirestore.ts`, `src/hooks/useWebSocket.ts`, and `src/components/DeviceSelectionScreen.tsx`.

**Important — current scope of the wrapper:** per the team's decision, Firestore is **not being replaced** yet; it's just wrapped so it *can* be swapped later without touching business logic. The immediate priority was making the desktop UI work locally showing live channels from the real device — that does **not** require the database or cloud storage replacement to be functional yet, and indeed the `local` mode's DB/storage implementations are intentionally minimal (in-memory, no persistence) since there's no AI pipeline connection locally yet.

## Environment variables — `.env` vs `.env.example`

- **`.env.example`** is committed to the repo. It documents every variable with safe/empty placeholder values. **Copy it to `.env` and fill in your own values.**
- **`.env`** (the real one, with your actual credentials) is **never committed**. It's already listed in `.gitignore` (`.env*` with an exception for `!.env.example`). Never share your `.env` file with anyone, and never paste its contents into chat, issues, or commits.
- There is a separate `.env.example` for the frontend (repo root) and one for the backend (`the-patch-server/.env.example`), because they're two independent Node processes with different variables.

## Running locally (no GCP/Firebase account needed)

This is the fastest way to get the desktop UI showing live channels from a real ESP32 device on your local network.

### 1. Backend

```bash
cd the-patch-server
npm install
cp .env.example .env
# .env.example already defaults to APP_MODE=local — no further edits needed
npm start
# → "The Patch WS Server running on port 8080"
```

In `local` mode the server does **not** require `firebase-admin` credentials or a GCS bucket. It authenticates web clients without a token, and writes ECG chunks (if it gets that far) to `the-patch-server/local-data/` on disk instead of GCS.

### 2. Point your ESP32 at your machine

Your ESP32 device connects the same way it always did (`{ type: 'auth', mac: '<device-mac>' }` over the WebSocket) — it doesn't need to know or care whether the server is in `local` or `cloud` mode. Just make sure the device is configured to connect to `ws://<your-machine-local-ip>:8080` instead of the production URL.

### 3. Frontend

```bash
# from the repo root
npm install
cp .env.example .env
```

Edit `.env`:

```
VITE_APP_MODE=local
VITE_WS_URL=ws://localhost:8080/ws
```

(If you're opening the app from another device on your network — e.g. a tablet — use your machine's LAN IP instead of `localhost`, e.g. `ws://192.168.1.23:8080/ws`.)

```bash
npm run dev
# → opens on http://localhost:3000 (or your LAN IP, since `--host=0.0.0.0` is already set)
```

In `local` mode:
- There is **no login screen** — a fixed local user is assigned automatically.
- The device list (used to pick which MAC to monitor) is stored in your browser's `localStorage` instead of Firestore. Add your device's MAC address on the "My Devices" screen the same way you would in cloud mode.
- Once you select the device, the UI connects to your local `the-patch-server` and should show live channels as soon as the ESP32 sends data.
- Event history (the little side panel of past tachycardia/bradycardia/etc. events) is **not persisted** in local mode — this wasn't a requirement for the first local milestone, since there's no AI/DB pipeline connected locally yet.

## Running in cloud mode (production / staging)

### Backend

```bash
cd the-patch-server
npm install
cp .env.example .env
```

Edit `.env`:

```
APP_MODE=cloud
GOOGLE_CLOUD_PROJECT=<your-gcp-project-id>
GCS_BUCKET_NAME=<your-bucket-name>
FIRMWARE_BUCKET_NAME=<optional, defaults to GCS_BUCKET_NAME>
```

On Cloud Run, credentials are obtained automatically from the environment — no service account key file is needed. If you run this outside Cloud Run (e.g. locally against real GCP), you'll need `GOOGLE_APPLICATION_CREDENTIALS` pointing at a service account key, per the standard `firebase-admin` / `@google-cloud/storage` setup.

**Note:** unlike before, there are no hidden fallback defaults for the project ID or bucket name. If a required variable is missing in `cloud` mode, the server throws a clear error at startup instead of silently trying to reach Areteus's real infrastructure — this matters for anyone running this open-source project without Areteus credentials, so a misconfiguration fails loudly instead of leaking which project/bucket the company uses.

### Frontend

```
VITE_APP_MODE=cloud   # or omit — cloud is the default
VITE_WS_URL=wss://<your-deployed-server>/ws
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

If any `VITE_FIREBASE_*` variable is missing while `VITE_APP_MODE=cloud` (or unset), the app throws a clear error on load instead of connecting with partial/broken config.

## Project structure

```
the_patch_sw/
  src/
    lib/
      appConfig.ts        <- APP_MODE / IS_LOCAL_MODE / WS_URL (single source of truth)
      firebase.ts         <- Firebase init, skipped entirely in local mode
    hooks/
      useAuth.ts          <- login/logout + auth state (bypassed in local mode)
      useFirestore.ts     <- event history sync (no-op in local mode)
      useWebSocket.ts     <- live ECG data from the-patch-server
    components/
      DeviceSelectionScreen.tsx   <- device list (Firestore in cloud, localStorage in local)
      desktop/ , mobile/          <- presentation layers, share the same hooks/store
    store/useStore.ts     <- global zustand store (vitals, alerts, events, auth state)
  the-patch-server/
    server.cjs             <- WebSocket + HTTP server, provider-agnostic
    providers/              <- wrapper/adapter layer (see Architecture section above)
  mock/mock-esp32.cjs      <- simulates a real ESP32 device for testing the full pipeline
```

## What's intentionally NOT done yet

Per the team's prioritization, these are known follow-ups, not oversights:

- **Local persistence for devices/users/events** is in-memory/`localStorage` only — fine for iterating on the UI, not meant for anything long-lived yet. If/when needed, this is where a local Postgres/SQLite/Supabase instance would plug in behind `db-provider.local.cjs` and `useFirestore.ts`.
- **Local storage of ECG chunks** writes to disk but has no retention/cleanup policy — it's there so the 10-second chunking pipeline doesn't crash, not as a real data lake.
- **OTA in local mode** returns `file://` paths instead of signed URLs — untested end-to-end, since OTA wasn't part of the local-UI priority.
