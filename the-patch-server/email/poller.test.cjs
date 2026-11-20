'use strict';
/**
 * Phase 3 tests: poll auth (OIDC), /internal/email/poll handler, poll job
 * (locks, idempotency, backoff, caps, uidValidity) and /api/email/alerts*.
 * IMAP, token verification, db and clock are all mocked/in-memory.
 * Run: node --test email/poller.test.cjs   (or npm run test:email)
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.APP_MODE = 'local';
process.env.EMAIL_MONITOR_ENABLED = 'true';
process.env.EMAIL_MONITOR_UIDS = 'u1,u2,u3,u4,u5,u6,u7,u8,uid-allowed';
process.env.EMAIL_CRED_KEY = crypto.randomBytes(32).toString('base64');

for (const key of Object.keys(require.cache)) {
  if (/the-patch-server[\\/](email|providers)[\\/]/.test(key)) {
    delete require.cache[key];
  }
}

const db = require('../providers/db-provider.local.cjs');
const { encrypt, decrypt } = require('./credentialCrypto.cjs');
const { createPollAuthVerifier } = require('./pollAuth.cjs');
const { createEmailPollHandler } = require('./pollHandler.cjs');
const { runEmailPoll, backoffMinutes } = require('./poller.cjs');
const { createEmailApiHandler } = require('./api.cjs');
const { POLL_LIMITS } = require('./config.cjs');

const MIN = 60 * 1000;
const T0 = 1_800_000_000_000;

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockRes() {
  return {
    statusCode: 0,
    body: null,
    writeHead(status) {
      this.statusCode = status;
    },
    end(raw) {
      this.body = raw ? JSON.parse(raw) : null;
    },
  };
}

function mockReq(method, path, bodyObj, authorization = 'Bearer test') {
  const json = bodyObj == null ? '' : JSON.stringify(bodyObj);
  return {
    method,
    url: path,
    headers: { host: 'localhost', authorization },
    _listeners: {},
    on(ev, fn) {
      this._listeners[ev] = fn;
      if (ev === 'end') {
        queueMicrotask(() => {
          if (this._listeners.data && json) this._listeners.data(Buffer.from(json));
          this._listeners.end && this._listeners.end();
        });
      }
      return this;
    },
    resume() {},
  };
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid_json'));
      }
    });
  });
}

function sendJson(_req, res, status, obj) {
  res.writeHead(status);
  res.end(JSON.stringify(obj));
}

function sendJsonBodyError(req, res, err) {
  sendJson(req, res, 400, { error: err?.message || 'invalid_json' });
}

function msg(uid, subject, from = 'sender@example.com', date = new Date(T0 - 1000)) {
  return { uid, subject, from, date };
}

function codeError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

/** IMAP mock. `handler(opts, callNumber)` returns a result or throws. Never records the password. */
function makeFetch(handler) {
  const calls = [];
  const fn = async (opts) => {
    calls.push({ host: opts.host, lastUid: opts.lastUid, uidValidity: opts.uidValidity });
    return handler(opts, calls.length);
  };
  fn.calls = calls;
  return fn;
}

const clock = { t: T0 };

async function seed(uid, extra = {}, keywords = ['factura']) {
  await db.setEmailAccount(uid, {
    provider: 'yahoo',
    email: `${uid}@yahoo.com`,
    credEnc: encrypt('pw-secret'),
    lastUid: 10,
    uidValidity: 7,
    status: 'ok',
    lastCheckedAt: 0,
    lastError: null,
    consecutiveFailures: 0,
    nextCheckAt: null,
    ...extra,
  });
  if (keywords) await db.setEmailMonitorSettings(uid, { keywords });
}

function poll(uids, fetchNewEnvelopes, { deps = {}, limits } = {}) {
  return runEmailPoll({
    uids,
    deps: {
      dbProvider: db,
      fetchNewEnvelopes,
      decrypt,
      now: () => clock.t,
      ...deps,
    },
    limits,
  });
}

function captureLogs() {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  return {
    text: () => lines.join('\n'),
    restore: () => {
      console.log = orig;
    },
  };
}

beforeEach(() => {
  db._resetEmailStore();
  clock.t = T0;
});

// ─── 1. OIDC verification ───────────────────────────────────────────────────

describe('pollAuth (OIDC)', () => {
  const goodPayload = { email: 'poller@proj.iam.gserviceaccount.com', email_verified: true };
  const cfg = {
    audiences: ['https://svc.run.app', 'https://tag---svc.run.app'],
    serviceAccount: 'poller@proj.iam.gserviceaccount.com',
  };

  it('accepts a valid token and passes ALL configured audiences', async () => {
    let seenAud;
    const verify = createPollAuthVerifier({
      getConfig: () => cfg,
      verifyIdToken: async (_t, aud) => {
        seenAud = aud;
        return goodPayload;
      },
    });
    assert.equal(await verify(mockReq('POST', '/internal/email/poll', null, 'Bearer tok')), true);
    assert.deepEqual(seenAud, cfg.audiences);
  });

  it('fails closed when EMAIL_POLL_SA or EMAIL_POLL_AUDIENCES is missing', async () => {
    let called = 0;
    const verifyIdToken = async () => {
      called += 1;
      return goodPayload;
    };
    const req = mockReq('POST', '/internal/email/poll', null, 'Bearer tok');
    const noSa = createPollAuthVerifier({
      verifyIdToken,
      getConfig: () => ({ audiences: cfg.audiences, serviceAccount: '' }),
    });
    const noAud = createPollAuthVerifier({
      verifyIdToken,
      getConfig: () => ({ audiences: [], serviceAccount: cfg.serviceAccount }),
    });
    assert.equal(await noSa(req), false);
    assert.equal(await noAud(req), false);
    assert.equal(called, 0, 'must not even try to verify without config');
  });

  it('rejects missing header, bad token, unverified email and wrong service account', async () => {
    const mk = (fn) => createPollAuthVerifier({ getConfig: () => cfg, verifyIdToken: fn });
    const req = mockReq('POST', '/x', null, 'Bearer tok');

    assert.equal(await mk(async () => goodPayload)(mockReq('POST', '/x', null, '')), false);
    assert.equal(
      await mk(async () => {
        throw new Error('bad signature');
      })(req),
      false
    );
    assert.equal(
      await mk(async () => ({ ...goodPayload, email_verified: false }))(req),
      false
    );
    assert.equal(await mk(async () => ({ email: goodPayload.email }))(req), false);
    assert.equal(
      await mk(async () => ({ ...goodPayload, email: 'attacker@evil.com' }))(req),
      false
    );
  });

  it('default env reader: unset env → false', async () => {
    delete process.env.EMAIL_POLL_SA;
    delete process.env.EMAIL_POLL_AUDIENCES;
    const verify = createPollAuthVerifier({
      verifyIdToken: async () => goodPayload,
    });
    assert.equal(await verify(mockReq('POST', '/x', null, 'Bearer tok')), false);
  });
});

// ─── 2. /internal/email/poll handler ────────────────────────────────────────

describe('/internal/email/poll handler', () => {
  it('returns false for other paths', async () => {
    const handler = createEmailPollHandler({
      sendJson,
      verifyPollRequest: async () => true,
      runEmailPoll: async () => ({}),
    });
    assert.equal(await handler(mockReq('POST', '/api/email/status'), mockRes()), false);
  });

  it('401 generic body without running the job when token is invalid', async () => {
    let ran = 0;
    const handler = createEmailPollHandler({
      sendJson,
      verifyPollRequest: async () => false,
      runEmailPoll: async () => {
        ran += 1;
        return {};
      },
    });
    for (const method of ['POST', 'GET']) {
      const res = mockRes();
      assert.equal(
        await handler(mockReq(method, '/internal/email/poll', null, 'Bearer secret-token-123'), res),
        true
      );
      assert.equal(res.statusCode, 401);
      assert.deepEqual(res.body, { error: 'unauthorized' });
    }
    assert.equal(ran, 0);
  });

  it('401 when EMAIL_POLL_* are unset (real verifier, fail closed)', async () => {
    delete process.env.EMAIL_POLL_SA;
    delete process.env.EMAIL_POLL_AUDIENCES;
    let ran = 0;
    const handler = createEmailPollHandler({
      sendJson,
      runEmailPoll: async () => {
        ran += 1;
        return {};
      },
    });
    const res = mockRes();
    await handler(mockReq('POST', '/internal/email/poll', null, 'Bearer anything'), res);
    assert.equal(res.statusCode, 401);
    assert.equal(ran, 0);
  });

  it('200 with counts only, after the job finished; never logs the token', async () => {
    let finished = false;
    let seenUids;
    const handler = createEmailPollHandler({
      sendJson,
      verifyPollRequest: async () => true,
      getUids: () => ['u1', 'u2'],
      runEmailPoll: async ({ uids }) => {
        seenUids = uids;
        await new Promise((r) => setTimeout(r, 10));
        finished = true;
        return { processed: 2, alerts: 3, errors: 1, skipped: 0, secret: 'leak' };
      },
    });
    const logs = captureLogs();
    const res = mockRes();
    try {
      await handler(mockReq('POST', '/internal/email/poll', null, 'Bearer secret-token-123'), res);
    } finally {
      logs.restore();
    }
    assert.equal(finished, true, 'response only after all work completed');
    assert.deepEqual(seenUids, ['u1', 'u2']);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { processed: 2, alerts: 3, errors: 1, skipped: 0 });
    assert.ok(!logs.text().includes('secret-token-123'));
  });

  it('405 for valid token with a non-POST method', async () => {
    const handler = createEmailPollHandler({
      sendJson,
      verifyPollRequest: async () => true,
      runEmailPoll: async () => ({}),
    });
    const res = mockRes();
    await handler(mockReq('GET', '/internal/email/poll'), res);
    assert.equal(res.statusCode, 405);
  });
});

// ─── 3. poll job ────────────────────────────────────────────────────────────

describe('runEmailPoll — alerts & idempotency', () => {
  it('creates an alert with the expected fields and advances the cursor after writing', async () => {
    await seed('u1');
    const created = [];
    const capturing = {
      ...db,
      createEmailAlert: async (uid, id, data) => {
        // cursor must NOT have moved yet while alerts are being written
        assert.equal((await db.getEmailAccount(uid)).lastUid, 10);
        created.push({ id, data });
        return db.createEmailAlert(uid, id, data);
      },
    };
    const longSubject = `Factura ${'x'.repeat(500)}`;
    const fetch = makeFetch(() => ({
      messages: [msg(11, 'hola'), msg(12, longSubject)],
      lastUid: 12,
      uidValidity: 7,
    }));

    const res = await poll(['u1'], fetch, { deps: { dbProvider: capturing } });
    assert.deepEqual(res, { processed: 1, alerts: 1, errors: 0, skipped: 0 });

    assert.equal(created.length, 1);
    const { id, data } = created[0];
    assert.equal(id, '7_12');
    assert.equal(data.subject.length, 200);
    assert.equal(data.from, 'sender@example.com');
    assert.deepEqual(data.matchedKeywords, ['factura']);
    assert.equal(data.read, false);
    assert.equal(data.createdAt, T0);
    assert.ok(data.expiresAt instanceof Date);
    assert.equal(data.expiresAt.getTime() - data.createdAt, 30 * 24 * 60 * MIN);
    assert.equal(typeof data.date, 'number');

    const acc = await db.getEmailAccount('u1');
    assert.equal(acc.lastUid, 12);
    assert.equal(acc.status, 'ok');
    assert.equal(acc.lastCheckedAt, T0);
    assert.equal(acc.lastError, null);
    assert.equal(acc.lockUntil, null, 'lock released');
  });

  it('same alert twice = one alert (retry after the cursor failed to advance)', async () => {
    await seed('u1');
    const result = { messages: [msg(11, 'Factura marzo')], lastUid: 11, uidValidity: 7 };
    const fetch = makeFetch(() => result);

    const first = await poll(['u1'], fetch);
    assert.equal(first.alerts, 1);

    // Simulate "alerts written but cursor write lost": rewind the cursor.
    const acc = await db.getEmailAccount('u1');
    await db.setEmailAccount('u1', { ...acc, lastUid: 10 });

    const second = await poll(['u1'], fetch);
    assert.equal(second.alerts, 0, 'existing id ignored without error');
    assert.equal(second.errors, 0);
    assert.equal((await db.listEmailAlerts('u1', { limit: 50 })).length, 1);
  });

  it('does not advance the cursor when alert writing fails; retry creates them once', async () => {
    await seed('u1');
    const failing = {
      ...db,
      createEmailAlert: async () => {
        throw new Error('firestore down');
      },
    };
    const fetch = makeFetch(() => ({
      messages: [msg(11, 'Factura A')],
      lastUid: 11,
      uidValidity: 7,
    }));

    const bad = await poll(['u1'], fetch, { deps: { dbProvider: failing } });
    assert.equal(bad.errors, 1);
    let acc = await db.getEmailAccount('u1');
    assert.equal(acc.lastUid, 10, 'cursor unchanged');
    assert.equal(acc.status, 'ok', 'status unchanged for non-IMAP failures');
    assert.equal(acc.lockUntil, null, 'lock released');

    const good = await poll(['u1'], fetch);
    assert.equal(good.processed, 1);
    assert.equal(good.alerts, 1);
    acc = await db.getEmailAccount('u1');
    assert.equal(acc.lastUid, 11);
  });

  it('no keywords: advances the cursor and creates no alerts', async () => {
    await seed('u1', {}, null);
    const fetch = makeFetch(() => ({
      messages: [msg(11, 'Factura A')],
      lastUid: 11,
      uidValidity: 7,
    }));
    const res = await poll(['u1'], fetch);
    assert.equal(res.processed, 1);
    assert.equal(res.alerts, 0);
    assert.equal((await db.getEmailAccount('u1')).lastUid, 11);

    await db.setEmailMonitorSettings('u1', { keywords: [] });
    const fetch2 = makeFetch(() => ({
      messages: [msg(12, 'Factura B')],
      lastUid: 12,
      uidValidity: 7,
    }));
    const res2 = await poll(['u1'], fetch2);
    assert.equal(res2.alerts, 0);
    assert.equal((await db.getEmailAccount('u1')).lastUid, 12);
  });

  it('empty mailbox at connect (lastUid null, uidValidity set) starts from UID 0', async () => {
    await seed('u1', { lastUid: null });
    const fetch = makeFetch(() => ({ messages: [], lastUid: null, uidValidity: 7 }));
    await poll(['u1'], fetch);
    assert.equal(fetch.calls[0].lastUid, 0);
  });
});

describe('runEmailPoll — caps', () => {
  it('more than 20 matches → a single summary alert, cursor advances', async () => {
    await seed('u1');
    const messages = Array.from({ length: 30 }, (_, i) => msg(11 + i, `Factura ${i}`));
    const fetch = makeFetch(() => ({ messages, lastUid: 40, uidValidity: 7 }));
    const res = await poll(['u1'], fetch);
    assert.equal(res.alerts, 1);
    const alerts = await db.listEmailAlerts('u1', { limit: 50 });
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, 'summary');
    assert.equal(alerts[0].matchCount, 30);
    assert.match(alerts[0].subject, /^30 emails match/);
    assert.equal((await db.getEmailAccount('u1')).lastUid, 40);

    // Retrying the same run does not duplicate the summary.
    const acc = await db.getEmailAccount('u1');
    await db.setEmailAccount('u1', { ...acc, lastUid: 10 });
    await poll(['u1'], fetch);
    assert.equal((await db.listEmailAlerts('u1', { limit: 50 })).length, 1);
  });

  it('exactly 20 matches → 20 individual alerts', async () => {
    await seed('u1');
    const messages = Array.from({ length: 20 }, (_, i) => msg(11 + i, `Factura ${i}`));
    const fetch = makeFetch(() => ({ messages, lastUid: 30, uidValidity: 7 }));
    const res = await poll(['u1'], fetch);
    assert.equal(res.alerts, 20);
  });

  it('looks at no more than 200 messages per account per run (newest 200)', async () => {
    await seed('u1');
    const messages = Array.from({ length: 250 }, (_, i) => msg(11 + i, `Factura ${i}`));
    const fetch = makeFetch(() => ({ messages, lastUid: 260, uidValidity: 7 }));
    await poll(['u1'], fetch);
    const [summary] = await db.listEmailAlerts('u1', { limit: 5 });
    assert.equal(summary.kind, 'summary');
    assert.equal(summary.matchCount, 200);
    assert.equal((await db.getEmailAccount('u1')).lastUid, 260);
  });

  it('caps accounts per run', async () => {
    const uids = ['u1', 'u2', 'u3', 'u4', 'u5'];
    for (const u of uids) await seed(u);
    const fetch = makeFetch(() => ({ messages: [], lastUid: 10, uidValidity: 7 }));
    const res = await poll(uids, fetch, { limits: { maxAccountsPerRun: 3 } });
    assert.equal(res.processed, 3);
    assert.equal(fetch.calls.length, 3);
  });

  it('limits concurrency', async () => {
    const uids = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];
    for (const u of uids) await seed(u);
    let inFlight = 0;
    let maxInFlight = 0;
    const fetch = makeFetch(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight -= 1;
      return { messages: [], lastUid: 10, uidValidity: 7 };
    });
    const res = await poll(uids, fetch, { limits: { concurrency: 2 } });
    assert.equal(res.processed, 6);
    assert.ok(maxInFlight <= 2, `max in flight was ${maxInFlight}`);
    assert.ok(maxInFlight >= 2);
  });

  it('stops starting accounts after the global deadline', async () => {
    const uids = ['u1', 'u2', 'u3'];
    for (const u of uids) await seed(u);
    const fetch = makeFetch(() => {
      clock.t += 150; // each account "takes" 150 ms of the fake clock
      return { messages: [], lastUid: 10, uidValidity: 7 };
    });
    const res = await poll(uids, fetch, { limits: { concurrency: 1, deadlineMs: 100 } });
    assert.equal(res.processed, 1);
    assert.equal(res.skipped, 2);
  });

  it('ignores uids outside EMAIL_MONITOR_UIDS', async () => {
    await seed('not-allowed');
    const fetch = makeFetch(() => ({ messages: [], lastUid: 10, uidValidity: 7 }));
    const res = await poll(['not-allowed'], fetch, {
      deps: { isUidAllowed: (u) => u !== 'not-allowed' },
    });
    assert.equal(fetch.calls.length, 0);
    assert.equal(res.processed, 0);
  });
});

describe('runEmailPoll — uidValidity', () => {
  it('uidValidityChanged: saves the new cursor and generates NO alerts', async () => {
    await seed('u1');
    const fetch = makeFetch((opts, n) => {
      if (n === 1) {
        return { messages: [], lastUid: 10, uidValidity: 99, uidValidityChanged: true };
      }
      // second call = re-pin cursor on the new mailbox generation
      assert.equal(opts.lastUid, null);
      assert.equal(opts.uidValidity, null);
      return { messages: [], lastUid: 500, uidValidity: 99 };
    });
    const res = await poll(['u1'], fetch);
    assert.equal(res.processed, 1);
    assert.equal(res.alerts, 0);
    const acc = await db.getEmailAccount('u1');
    assert.equal(acc.lastUid, 500);
    assert.equal(acc.uidValidity, 99);
    assert.equal(acc.status, 'ok');
    assert.equal((await db.listEmailAlerts('u1', { limit: 50 })).length, 0);
  });
});

describe('runEmailPoll — errors', () => {
  it('AUTH_FAILED sets auth_failed and is never retried until reconnect', async () => {
    await seed('uid-allowed');
    const fetch = makeFetch(() => {
      throw codeError('AUTH_FAILED');
    });

    const first = await poll(['uid-allowed'], fetch);
    assert.equal(first.errors, 1);
    let acc = await db.getEmailAccount('uid-allowed');
    assert.equal(acc.status, 'auth_failed');
    assert.equal(acc.lastError, 'AUTH_FAILED');
    assert.equal(acc.lockUntil, null);
    assert.equal(fetch.calls.length, 1);

    // Many hours later: still no retry.
    clock.t += 48 * 60 * MIN;
    const second = await poll(['uid-allowed'], fetch);
    assert.equal(fetch.calls.length, 1, 'no new IMAP attempt');
    assert.equal(second.skipped, 1);

    // Reconnect through the real /api/email/connect handler puts status back to ok.
    const api = createEmailApiHandler({
      verifyAuthHeader: async () => 'uid-allowed',
      sendJson,
      sendJsonBodyError,
      readJsonBody,
      dbProvider: db,
      encrypt,
      fetchNewEnvelopes: async () => ({ messages: [], lastUid: 77, uidValidity: 7 }),
    });
    const res = mockRes();
    await api(
      mockReq('POST', '/api/email/connect', {
        provider: 'yahoo',
        email: 'uid-allowed@yahoo.com',
        appPassword: 'new-app-pass',
      }),
      res
    );
    assert.equal(res.statusCode, 200);
    acc = await db.getEmailAccount('uid-allowed');
    assert.equal(acc.status, 'ok');
    assert.equal(acc.consecutiveFailures, 0);
    assert.equal(acc.nextCheckAt, null);

    const okFetch = makeFetch(() => ({ messages: [], lastUid: 77, uidValidity: 7 }));
    const third = await poll(['uid-allowed'], okFetch);
    assert.equal(third.processed, 1);
    assert.equal(okFetch.calls.length, 1);
  });

  it('an undecryptable credential stops retries (needs reconnect)', async () => {
    await seed('u1', { credEnc: { v: 1, iv: 'AAAA', tag: 'AAAA', data: 'AAAA' } });
    const fetch = makeFetch(() => ({ messages: [], lastUid: 10, uidValidity: 7 }));
    const res = await poll(['u1'], fetch);
    assert.equal(res.errors, 1);
    assert.equal(fetch.calls.length, 0);
    assert.equal((await db.getEmailAccount('u1')).status, 'auth_failed');
  });

  it('backoff: 5, 10, 20, 40, 60, 60 minutes; not retried before nextCheckAt', async () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 9].map((n) => backoffMinutes(n, POLL_LIMITS)),
      [5, 10, 20, 40, 60, 60, 60]
    );

    await seed('u1');
    const code = ['CONNECTION_FAILED', 'TIMEOUT'];
    const fetch = makeFetch((_o, n) => {
      throw codeError(code[n % 2]);
    });
    const expected = [5, 10, 20, 40, 60, 60];

    for (let i = 0; i < expected.length; i++) {
      const before = clock.t;
      const res = await poll(['u1'], fetch);
      assert.equal(res.errors, 1);
      const acc = await db.getEmailAccount('u1');
      assert.equal(acc.status, 'error');
      assert.equal(acc.consecutiveFailures, i + 1);
      assert.equal(acc.nextCheckAt, before + expected[i] * MIN);
      assert.ok(['CONNECTION_FAILED', 'TIMEOUT'].includes(acc.lastError));

      // Too early → skipped, no IMAP call.
      const callsBefore = fetch.calls.length;
      clock.t = acc.nextCheckAt - 1;
      const early = await poll(['u1'], fetch);
      assert.equal(early.skipped, 1);
      assert.equal(fetch.calls.length, callsBefore);

      clock.t = acc.nextCheckAt; // due now
    }

    // Success resets everything.
    const okFetch = makeFetch(() => ({ messages: [], lastUid: 10, uidValidity: 7 }));
    const res = await poll(['u1'], okFetch);
    assert.equal(res.processed, 1);
    const acc = await db.getEmailAccount('u1');
    assert.equal(acc.status, 'ok');
    assert.equal(acc.consecutiveFailures, 0);
    assert.equal(acc.nextCheckAt, null);
    assert.equal(acc.lastError, null);
  });

  it('one failing account does not stop the others', async () => {
    await seed('u1');
    await seed('u2');
    await seed('u3');
    const fetch = makeFetch((opts) => {
      if (opts.user === 'u2@yahoo.com') throw codeError('CONNECTION_FAILED');
      return { messages: [msg(11, 'Factura')], lastUid: 11, uidValidity: 7 };
    });
    const res = await poll(['u1', 'u2', 'u3'], fetch);
    assert.equal(res.processed, 2);
    assert.equal(res.errors, 1);
    assert.equal(res.alerts, 2);
    assert.equal((await db.getEmailAccount('u2')).status, 'error');
    assert.equal((await db.getEmailAccount('u3')).lastUid, 11);
  });
});

describe('runEmailPoll — locking', () => {
  it('acquireEmailLock fails while a live lock exists and works after it expires', async () => {
    await seed('u1');
    const a = await db.acquireEmailLock('u1', { token: 'A', now: T0, lockMs: 2 * MIN });
    assert.ok(a);
    const b = await db.acquireEmailLock('u1', { token: 'B', now: T0 + MIN, lockMs: 2 * MIN });
    assert.equal(b, null);
    const c = await db.acquireEmailLock('u1', { token: 'C', now: T0 + 2 * MIN + 1, lockMs: 2 * MIN });
    assert.ok(c);
    assert.equal(c.lockToken, 'C');
    // Writes by the stale holder are rejected.
    assert.equal(await db.updateEmailAccountIfLocked('u1', 'A', { lastUid: 999 }), false);
    assert.equal((await db.getEmailAccount('u1')).lastUid, 10);
  });

  it('skips an account locked by another run', async () => {
    await seed('u1', { lockUntil: T0 + MIN, lockToken: 'other-run' });
    const fetch = makeFetch(() => ({ messages: [], lastUid: 10, uidValidity: 7 }));
    const res = await poll(['u1'], fetch);
    assert.equal(fetch.calls.length, 0);
    assert.equal(res.skipped, 1);
    assert.equal((await db.getEmailAccount('u1')).lockToken, 'other-run');
  });

  it('takes over an expired lock', async () => {
    await seed('u1', { lockUntil: T0 - 1, lockToken: 'dead-run' });
    const fetch = makeFetch(() => ({ messages: [], lastUid: 10, uidValidity: 7 }));
    const res = await poll(['u1'], fetch);
    assert.equal(res.processed, 1);
  });

  it('two concurrent runs process the same account only once', async () => {
    await seed('u1');
    const fetch = makeFetch(async () => {
      await new Promise((r) => setTimeout(r, 25));
      return { messages: [msg(11, 'Factura')], lastUid: 11, uidValidity: 7 };
    });
    const [a, b] = await Promise.all([poll(['u1'], fetch), poll(['u1'], fetch)]);
    assert.equal(fetch.calls.length, 1);
    assert.equal(a.processed + b.processed, 1);
    assert.equal(a.skipped + b.skipped, 1);
    assert.equal((await db.listEmailAlerts('u1', { limit: 50 })).length, 1);
  });

  it('a reconnect during the poll wins: the stale run cannot overwrite the new cursor', async () => {
    await seed('u1');
    const fetch = makeFetch(async () => {
      // user reconnects (api connect = set merge:false) while IMAP is in flight
      await db.setEmailAccount('u1', {
        provider: 'yahoo',
        email: 'new@yahoo.com',
        credEnc: encrypt('other'),
        lastUid: 5000,
        uidValidity: 8,
        status: 'ok',
      });
      return { messages: [], lastUid: 11, uidValidity: 7 };
    });
    const res = await poll(['u1'], fetch);
    assert.equal(res.skipped, 1);
    const acc = await db.getEmailAccount('u1');
    assert.equal(acc.lastUid, 5000);
    assert.equal(acc.uidValidity, 8);
  });
});

describe('runEmailPoll — logging', () => {
  it('never logs passwords, subjects or senders', async () => {
    await seed('u1');
    const fetch = makeFetch(() => ({
      messages: [msg(11, 'Factura SECRET-SUBJECT', 'Boss <boss-secret@corp.example>')],
      lastUid: 11,
      uidValidity: 7,
    }));
    const logs = captureLogs();
    try {
      await poll(['u1'], fetch);
      await seed('u1');
      await poll(
        ['u1'],
        makeFetch(() => {
          throw codeError('AUTH_FAILED');
        })
      );
    } finally {
      logs.restore();
    }
    const text = logs.text();
    assert.ok(text.includes('email_poll_done'));
    for (const secret of ['pw-secret', 'SECRET-SUBJECT', 'boss-secret', 'corp.example', '@yahoo.com']) {
      assert.ok(!text.includes(secret), `log leaked ${secret}`);
    }
  });
});

// ─── 4. client endpoints: alerts ────────────────────────────────────────────

describe('/api/email/alerts*', () => {
  const api = createEmailApiHandler({
    verifyAuthHeader: async (req) => {
      const h = req.headers.authorization || '';
      if (h.includes('anon')) return null;
      if (h.includes('forbidden')) return 'uid-other';
      return 'uid-allowed';
    },
    sendJson,
    sendJsonBodyError,
    readJsonBody,
    dbProvider: db,
  });

  async function addAlerts(n) {
    for (let i = 1; i <= n; i++) {
      await db.createEmailAlert('uid-allowed', `7_${i}`, {
        kind: 'match',
        from: 'a@b.com',
        subject: `s${i}`,
        date: null,
        matchedKeywords: ['k'],
        createdAt: T0 + i,
        read: false,
        expiresAt: new Date(T0 + 1e9),
      });
    }
  }

  async function call(method, path, body, auth) {
    const res = mockRes();
    await api(mockReq(method, path, body, auth), res);
    return res;
  }

  it('requires auth and allowlist', async () => {
    assert.equal((await call('GET', '/api/email/alerts', null, 'Bearer anon')).statusCode, 401);
    assert.equal((await call('GET', '/api/email/alerts', null, 'Bearer forbidden')).statusCode, 403);
    assert.equal(
      (await call('POST', '/api/email/alerts/read', { all: true }, 'Bearer forbidden')).statusCode,
      403
    );
  });

  it('lists newest first with default 20 and a max of 50', async () => {
    await addAlerts(60);
    const def = await call('GET', '/api/email/alerts');
    assert.equal(def.statusCode, 200);
    assert.equal(def.body.alerts.length, 20);
    assert.equal(def.body.alerts[0].id, '7_60');

    const small = await call('GET', '/api/email/alerts?limit=3');
    assert.equal(small.body.alerts.length, 3);

    const big = await call('GET', '/api/email/alerts?limit=500');
    assert.equal(big.body.alerts.length, 50);

    const junk = await call('GET', '/api/email/alerts?limit=abc');
    assert.equal(junk.body.alerts.length, 20);
    assert.equal('expiresAt' in junk.body.alerts[0], false);
  });

  it('marks specific ids as read', async () => {
    await addAlerts(3);
    const res = await call('POST', '/api/email/alerts/read', { ids: ['7_1', '7_2', 'nope'] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.updated, 2);
    const list = (await call('GET', '/api/email/alerts')).body.alerts;
    assert.deepEqual(
      Object.fromEntries(list.map((a) => [a.id, a.read])),
      { '7_1': true, '7_2': true, '7_3': false }
    );
  });

  it('marks all as read', async () => {
    await addAlerts(4);
    const res = await call('POST', '/api/email/alerts/read', { all: true });
    assert.equal(res.body.updated, 4);
    const list = (await call('GET', '/api/email/alerts')).body.alerts;
    assert.ok(list.every((a) => a.read));
  });

  it('rejects malformed bodies', async () => {
    for (const body of [
      {},
      { ids: [] },
      { ids: 'x' },
      { ids: ['a/b'] },
      { ids: [1] },
      { all: 'yes' },
      { ids: Array.from({ length: 51 }, (_, i) => `id${i}`) },
    ]) {
      const res = await call('POST', '/api/email/alerts/read', body);
      assert.equal(res.statusCode, 400, JSON.stringify(body).slice(0, 40));
      assert.equal(res.body.error, 'invalid_request');
    }
  });
});
