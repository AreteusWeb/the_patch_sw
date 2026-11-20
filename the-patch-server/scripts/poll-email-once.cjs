'use strict';
/**
 * Run the email poll job once, locally, against the IN-MEMORY local db
 * (APP_MODE is forced to "local" — this never touches Firestore).
 *
 * Because the local db starts empty, the script seeds one account the same way
 * POST /api/email/connect does, then calls runEmailPoll({ uids: [uid] }).
 *
 * Usage:
 *   node scripts/poll-email-once.cjs <uid> [--rewind=N]
 *
 * Env (from the-patch-server/.env or the shell):
 *   POLL_TEST_EMAIL / POLL_TEST_APP_PASSWORD   (fallback: YAHOO_TEST_EMAIL / YAHOO_TEST_APP_PASSWORD)
 *   POLL_TEST_PROVIDER   yahoo | turbify (default yahoo)
 *   POLL_TEST_KEYWORDS   comma-separated, e.g. "factura,urgente"
 *   EMAIL_CRED_KEY       optional; a throw-away key is generated if missing
 *
 * --rewind=N moves the cursor back N UIDs after connecting, so the last N
 * messages in the mailbox count as "new" (otherwise a fresh connect only pins
 * the cursor and finds nothing).
 *
 * Output: counts and statuses only — never passwords, subjects, or senders.
 */
try {
  require('dotenv').config();
} catch (_) {
  /* dotenv optional */
}

const crypto = require('crypto');

const args = process.argv.slice(2);
const uid = args.find((a) => !a.startsWith('--'));
const rewindArg = args.find((a) => a.startsWith('--rewind='));
const rewind = rewindArg ? Math.max(0, Number.parseInt(rewindArg.split('=')[1], 10) || 0) : 0;

if (!uid) {
  console.error('Usage: node scripts/poll-email-once.cjs <uid> [--rewind=N]');
  process.exit(1);
}

// Local-only guard rails (set BEFORE loading any module that reads them).
process.env.APP_MODE = 'local';
process.env.EMAIL_MONITOR_ENABLED = 'true';
process.env.EMAIL_MONITOR_UIDS = uid; // allowlist = just this uid, this process only
if (!process.env.EMAIL_CRED_KEY) {
  process.env.EMAIL_CRED_KEY = crypto.randomBytes(32).toString('base64');
}

const email = process.env.POLL_TEST_EMAIL || process.env.YAHOO_TEST_EMAIL;
const pass = process.env.POLL_TEST_APP_PASSWORD || process.env.YAHOO_TEST_APP_PASSWORD;
const providerKey = process.env.POLL_TEST_PROVIDER || 'yahoo';
const keywords = String(process.env.POLL_TEST_KEYWORDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!email || !pass) {
  console.error(
    'Missing POLL_TEST_EMAIL / POLL_TEST_APP_PASSWORD (or YAHOO_TEST_EMAIL / YAHOO_TEST_APP_PASSWORD).'
  );
  process.exit(1);
}

const db = require('../providers/db-provider.cjs');
const { resolveEmailProvider } = require('../email/config.cjs');
const { fetchNewEnvelopes } = require('../email/imapClient.cjs');
const { encrypt } = require('../email/credentialCrypto.cjs');
const { runEmailPoll } = require('../email/poller.cjs');

(async () => {
  const provider = resolveEmailProvider(providerKey);
  if (!provider) {
    console.error('POLL_TEST_PROVIDER must be yahoo or turbify.');
    process.exit(1);
  }

  // Seed the account like /api/email/connect.
  const cursor = await fetchNewEnvelopes({
    host: provider.host,
    port: provider.port,
    user: email,
    pass,
    lastUid: null,
    uidValidity: null,
  });
  const lastUid =
    cursor.lastUid != null && rewind > 0 ? Math.max(0, cursor.lastUid - rewind) : cursor.lastUid;

  const now = Date.now();
  await db.setEmailAccount(uid, {
    provider: provider.key,
    email,
    credEnc: encrypt(pass),
    lastUid: lastUid ?? null,
    uidValidity: cursor.uidValidity ?? null,
    status: 'ok',
    lastCheckedAt: now,
    lastError: null,
    consecutiveFailures: 0,
    nextCheckAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.setEmailMonitorSettings(uid, { keywords, updatedAt: now });
  console.log(
    `seeded account (provider=${provider.key}, keywords=${keywords.length}, rewind=${rewind})`
  );

  const summary = await runEmailPoll({ uids: [uid] });
  console.log('poll result:', JSON.stringify(summary));

  const account = await db.getEmailAccount(uid);
  console.log(
    'account:',
    JSON.stringify({
      status: account?.status ?? null,
      lastError: account?.lastError ?? null,
      consecutiveFailures: account?.consecutiveFailures ?? 0,
      lastUid: account?.lastUid ?? null,
    })
  );
  const alerts = await db.listEmailAlerts(uid, { limit: 50 });
  console.log(`alerts stored: ${alerts.length} (unread: ${alerts.filter((a) => !a.read).length})`);
})().catch((err) => {
  // Code only — error messages could echo hostnames/usernames.
  console.error('poll-email-once failed:', err && err.code ? err.code : 'ERROR');
  process.exit(1);
});
