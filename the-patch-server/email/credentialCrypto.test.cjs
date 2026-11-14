'use strict';
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

describe('credentialCrypto', () => {
  before(() => {
    // Fresh 32-byte key for this test process (not a real secret).
    process.env.EMAIL_CRED_KEY = crypto.randomBytes(32).toString('base64');
  });

  it('round-trips plaintext', () => {
    const { encrypt, decrypt } = require('./credentialCrypto.cjs');
    const plain = 'app-password-example-üñícode';
    const payload = encrypt(plain);
    assert.equal(payload.v, 1);
    assert.ok(payload.iv && payload.tag && payload.data);
    assert.equal(decrypt(payload), plain);
  });

  it('uses a distinct IV each encrypt', () => {
    const { encrypt } = require('./credentialCrypto.cjs');
    const a = encrypt('same');
    const b = encrypt('same');
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.data, b.data);
  });

  it('fails when ciphertext is tampered', () => {
    const { encrypt, decrypt } = require('./credentialCrypto.cjs');
    const payload = encrypt('secret');
    const buf = Buffer.from(payload.data, 'base64');
    buf[0] = buf[0] ^ 0xff;
    payload.data = buf.toString('base64');
    assert.throws(() => decrypt(payload));
  });

  it('fails when auth tag is tampered', () => {
    const { encrypt, decrypt } = require('./credentialCrypto.cjs');
    const payload = encrypt('secret');
    const buf = Buffer.from(payload.tag, 'base64');
    buf[0] = buf[0] ^ 0xff;
    payload.tag = buf.toString('base64');
    assert.throws(() => decrypt(payload));
  });

  it('throws a clear error when EMAIL_CRED_KEY is missing', () => {
    const saved = process.env.EMAIL_CRED_KEY;
    delete process.env.EMAIL_CRED_KEY;
    delete require.cache[require.resolve('./credentialCrypto.cjs')];
    const { encrypt } = require('./credentialCrypto.cjs');
    assert.throws(() => encrypt('x'), /EMAIL_CRED_KEY is missing/);
    process.env.EMAIL_CRED_KEY = saved;
    delete require.cache[require.resolve('./credentialCrypto.cjs')];
  });

  it('throws when key length is wrong', () => {
    const saved = process.env.EMAIL_CRED_KEY;
    process.env.EMAIL_CRED_KEY = Buffer.from('too-short').toString('base64');
    delete require.cache[require.resolve('./credentialCrypto.cjs')];
    const { encrypt } = require('./credentialCrypto.cjs');
    assert.throws(() => encrypt('x'), /32 bytes/);
    process.env.EMAIL_CRED_KEY = saved;
    delete require.cache[require.resolve('./credentialCrypto.cjs')];
  });
});
