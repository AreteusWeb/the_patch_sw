# Architecture notes: cloud vs. local mode

This document covers the reasoning, implementation details, and known
gaps behind the provider/wrapper pattern. It's meant for the team working
on this codebase, not as a getting-started guide — for that, see the main
[`README.md`](../README.md).

## Why this exists

Two goals came out of a team meeting:

1. **Don't hard-code Google/Firebase.** Wrap access to auth, the database,
   and file storage behind generic interfaces, so switching providers later
   (e.g. Postgres/Supabase instead of Firestore, S3 instead of GCS) only
   means adding a new provider file — no changes to business logic.
2. **Make this runnable by anyone who clones the repo, fully locally**,
   without needing an Areteus GCP project, service account, or Firebase
   config. This matters because the project is open source.

Decision made at the time: **don't migrate off Firestore yet** — just wrap
it so it *can* be swapped later. The immediate priority was getting the
desktop UI to work locally, showing live channels from a real device. That
does not require the database or cloud storage replacement to be
functional — hence the `local` mode's DB/storage implementations are
intentionally minimal (in-memory / no persistence), since there's no AI
pipeline connected locally yet anyway.

## How it works: `APP_MODE` / `VITE_APP_MODE`

| | `cloud` (default) | `local` |
|---|---|---|
| Auth | Firebase Auth (real login) | None — a fixed local dev user is assigned automatically, no login screen |
| Database (devices/users) | Firestore | In-memory (backend) / `localStorage` (frontend) — not persisted across restarts |
| Raw ECG chunk storage | Google Cloud Storage | Local disk (`the-patch-server/local-data/`) |
| Requires GCP/Firebase credentials? | Yes | No |
| Intended for | Production, staging, most clients | Developers, self-hosted/advanced clients, quick iteration |

### Backend — wrapper/adapter pattern (ports & adapters)

```
the-patch-server/
  server.cjs                        <- only calls generic functions below, never
                                        imports firebase-admin or @google-cloud/storage directly
  providers/
    auth-provider.cjs                <- selector (reads APP_MODE)
    auth-provider.gcp.cjs            <- real Firebase Admin implementation
    auth-provider.local.cjs          <- no-op / fixed dev user, no token check
    storage-provider.cjs             <- selector
    storage-provider.gcp.cjs         <- real GCS implementation
    storage-provider.local.cjs       <- writes JSON chunks to disk instead
    db-provider.cjs                  <- selector
    db-provider.gcp.cjs              <- real Firestore implementation (devices/users)
    db-provider.local.cjs            <- in-memory Map implementation, resets on restart
```

`server.cjs` loads `.env` via `dotenv` and picks the right implementation
per provider based on `APP_MODE`. In `cloud` mode, if a required variable
(`GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET_NAME`) is missing, the process throws
a clear error at startup instead of silently falling back to a hidden
default — this used to point at Areteus's real dev project/bucket, which
was a real information-leak risk for an open-source repo (anyone running
it without realizing it would silently try to reach Areteus's
infrastructure).

The WebSocket auth handshake has a `local: true` path (no token) that the
**server only accepts if it's itself running in `APP_MODE=local`** — a
client claiming to be "local" is not trusted on a cloud-mode server. This
is the actual security boundary; there is no scenario where a production
deployment accepts unauthenticated web clients.

### Frontend — single config source

`src/lib/appConfig.ts` exports `APP_MODE`, `IS_LOCAL_MODE`, and `WS_URL`,
read once from `VITE_APP_MODE` / `VITE_WS_URL`. Everything else branches
off `IS_LOCAL_MODE`:

- `src/lib/firebase.ts` — skips Firebase init entirely in local mode (no
  `initializeApp` call at all, not even with dummy values).
- `src/hooks/useAuth.ts` — in local mode, assigns a fixed dev user
  (`local-dev-user`) synchronously and never touches Firebase Auth; the
  login screen is never shown because `App.tsx`'s gate is just "is there a
  `currentUser`".
- `src/hooks/useFirestore.ts` — becomes a no-op in local mode (no event
  history sync).
- `src/hooks/useWebSocket.ts` — `WS_URL` is no longer hard-coded to the
  production URL; in local mode, sends `{ type: 'auth', local: true,
  deviceMac }` instead of a Firebase ID token.
- `src/components/DeviceSelectionScreen.tsx` — device list comes from
  `localStorage` in local mode instead of the user's Firestore document.

## What's intentionally NOT done yet

These are known, deliberate gaps — not oversights:

- **No local persistence for devices/users/events.** In-memory on the
  backend, `localStorage` on the frontend. Fine for iterating on the UI;
  not meant for anything long-lived. If/when real local persistence is
  needed, this is where a local Postgres/SQLite/Supabase instance would
  plug in behind `db-provider.local.cjs` and `useFirestore.ts`.
- **Local ECG chunk storage has no retention/cleanup policy.** It writes
  to `the-patch-server/local-data/ecg-chunks/` so the 10-second chunking
  pipeline doesn't crash, not as a real data lake — this directory is
  git-ignored and grows unbounded; clear it out periodically during local
  dev.
- **OTA in local mode is untested end-to-end.** It returns `file://` paths
  instead of signed URLs. OTA wasn't part of the local-UI priority.
- **Event history isn't persisted locally**, since there's no local
  DB/AI-pipeline connection yet.

## Next steps (not started)

- Decide on and implement the actual local DB replacement (Postgres vs.
  SQLite vs. Supabase) behind `db-provider.local.cjs`, if/when local
  persistence becomes a real requirement (e.g. once local AI/preprocessing
  work starts).
- Consider whether `storage-provider.local.cjs` needs retention/cleanup, or
  whether local mode should just not persist raw chunks at all.
- If the company ever moves off Firestore for the cloud path too, that's a
  new `db-provider.<x>.cjs` — same pattern, no changes needed to
  `server.cjs` or the frontend hooks.
