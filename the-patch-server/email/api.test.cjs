'use strict';
/**
 * Phase 2 /api/email/* handler tests (mocked IMAP + in-memory Firestore stand-in).
 * Run: node --test email/*.test.cjs
 */
const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

process.env.APP_MODE = 'local';
process.env.EMAIL_MONITOR_ENABLED = 'true';
process.env.EMAIL_MONITOR_UIDS = 'uid-allowed';
process.env.EMAIL_CRED_KEY = crypto.randomBytes(32).toString('base64');

// Fresh module graph after env is set.
for (const key of Object.keys(require.cache)) {
  if (/the-patch-server[\\/](email|providers)[\\/]/.test(key)) {
    delete require.cache[key];
  }
}

const { createEmailApiHandler } = require('./api.cjs');
const { validateKeywords } = require('./keywordMatcher.cjs');
const {
  checkConnectRateLimit,
  recordConnectAttempt,
  _resetConnectRateLimit,
} = require('./connectRateLimit.cjs');
const db = require('../providers/db-provider.local.cjs');
const { encrypt } = require('./credentialCrypto.cjs');

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

function mockReq(method, path, bodyObj) {
  const json = bodyObj == null ? '' : JSON.stringify(bodyObj);
  const req = {
    method,
    url: path,
    headers: {
      host: 'localhost',
      authorization: 'Bearer test',
      'content-type': 'application/json',
    },
    _listeners: {},
    on(ev, fn) {
      this._listeners[ev] = fn;
      if (ev === 'end') {
        queueMicrotask(() => {
          if (this._listeners.data && json) {
            this._listeners.data(Buffer.from(json));
          }
          this._listeners.end && this._listeners.end();
        });
      }
      return this;
    },
    resume() {},
  };
  return req;
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

function sendJsonBodyError(_req, res, err) {
  sendJson(_req, res, 400, { error: err?.message || 'invalid_json' });
}

describe('validateKeywords', () => {
  it('trims, enforces length, rejects duplicates ignoring accents', () => {
    const ok = validateKeywords(['  Factura  ', 'urgente']);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.keywords, ['Factura', 'urgente']);

    const dup = validateKeywords(['factura', 'FÁCTURA']);
    assert.equal(dup.ok, false);

    const short = validateKeywords(['a']);
    assert.equal(short.ok, false);

    const tooMany = validateKeywords(Array.from({ length: 21 }, (_, i) => `kw${i}`));
    assert.equal(tooMany.ok, false);
  });
});

describe('connectRateLimit', () => {
  beforeEach(() => _resetConnectRateLimit());

  it('allows 5 attempts then blocks', () => {
    const uid = 'rate-uid';
    for (let i = 0; i < 5; i++) {
      assert.equal(checkConnectRateLimit(uid).allowed, true);
      recordConnectAttempt(uid);
    }
    assert.equal(checkConnectRateLimit(uid).allowed, false);
  });
});

describe('email api handler', () => {
  let handler;
  let fetchCalls;

  before(() => {
    fetchCalls = [];
    handler = createEmailApiHandler({
      verifyAuthHeader: async (req) => {
        const auth = req.headers.authorization || '';
        if (auth.includes('forbidden')) return 'uid-other';
        if (auth.includes('anon')) return null;
        return 'uid-allowed';
      },
      sendJson,
      sendJsonBodyError,
      readJsonBody,
      dbProvider: db,
      encrypt,
      fetchNewEnvelopes: async (opts) => {
        fetchCalls.push({
          host: opts.host,
          user: opts.user,
          lastUid: opts.lastUid,
        });
        if (opts.pass === 'bad-pass') {
          const e = new Error('login failed');
          e.code = 'AUTH_FAILED';
          throw e;
        }
        return {
          messages: [],
          lastUid: 42,
          uidValidity: 99,
        };
      },
    });
  });

  beforeEach(async () => {
    fetchCalls.length = 0;
    _resetConnectRateLimit();
    db._resetEmailStore();
  });

  it('returns false for non-email paths', async () => {
    const req = mockReq('GET', '/api/coach/session');
    const res = mockRes();
    const handled = await handler(req, res);
    assert.equal(handled, false);
  });

  it('401 when unauthenticated', async () => {
    const req = mockReq('GET', '/api/email/status');
    req.headers.authorization = 'Bearer anon';
    const res = mockRes();
    assert.equal(await handler(req, res), true);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'unauthorized');
  });

  it('403 when uid not in EMAIL_MONITOR_UIDS', async () => {
    const req = mockReq('GET', '/api/email/status');
    req.headers.authorization = 'Bearer forbidden';
    const res = mockRes();
    assert.equal(await handler(req, res), true);
    assert.equal(res.statusCode, 403);
  });

  it('connect rejects free host / unknown provider', async () => {
    const req = mockReq('POST', '/api/email/connect', {
      provider: 'evil.com',
      email: 'a@b.com',
      appPassword: 'xxxx-xxxx',
    });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, 'invalid_provider');
    assert.equal(fetchCalls.length, 0);
  });

  it('connect succeeds, stores encrypted cred, status omits credEnc', async () => {
    const req = mockReq('POST', '/api/email/connect', {
      provider: 'yahoo',
      email: 'user@yahoo.com',
      appPassword: 'good-app-pass',
    });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.email, 'user@yahoo.com');
    assert.equal(fetchCalls[0].host, 'imap.mail.yahoo.com');
    assert.equal(fetchCalls[0].lastUid, null);

    const stored = await db.getEmailAccount('uid-allowed');
    assert.ok(stored.credEnc);
    assert.equal(stored.lastUid, 42);
    assert.equal(stored.uidValidity, 99);
    assert.equal(stored.status, 'ok');

    const statusReq = mockReq('GET', '/api/email/status');
    const statusRes = mockRes();
    await handler(statusReq, statusRes);
    assert.equal(statusRes.statusCode, 200);
    assert.equal(statusRes.body.connected, true);
    assert.equal(statusRes.body.email, 'user@yahoo.com');
    assert.equal(statusRes.body.credEnc, undefined);
    assert.equal('credEnc' in statusRes.body, false);
  });

  it('connect maps AUTH_FAILED', async () => {
    const req = mockReq('POST', '/api/email/connect', {
      provider: 'turbify',
      email: 'user@yahoo.com',
      appPassword: 'bad-pass',
    });
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, 'AUTH_FAILED');
  });

  it('keywords GET/PUT round-trip', async () => {
    const putReq = mockReq('PUT', '/api/email/keywords', {
      keywords: [' factura ', 'urgente'],
    });
    const putRes = mockRes();
    await handler(putReq, putRes);
    assert.equal(putRes.statusCode, 200);
    assert.deepEqual(putRes.body.keywords, ['factura', 'urgente']);

    const getReq = mockReq('GET', '/api/email/keywords');
    const getRes = mockRes();
    await handler(getReq, getRes);
    assert.deepEqual(getRes.body.keywords, ['factura', 'urgente']);
  });

  it('DELETE account removes credentials', async () => {
    await db.setEmailAccount('uid-allowed', {
      provider: 'yahoo',
      email: 'a@b.com',
      credEnc: { v: 1, iv: 'x', tag: 'y', data: 'z' },
      status: 'ok',
    });
    const req = mockReq('DELETE', '/api/email/account');
    const res = mockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(await db.getEmailAccount('uid-allowed'), null);
  });
});
