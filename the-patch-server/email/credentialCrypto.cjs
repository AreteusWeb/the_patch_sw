'use strict';
/**
 * AES-256-GCM helpers for email credentials at rest.
 * Key: EMAIL_CRED_KEY = 32 raw bytes encoded as base64 (Secret Manager → Cloud Run).
 * Never log plaintext or the key.
 */
const crypto = require('crypto');

const PAYLOAD_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;

function getKey() {
  const b64 = process.env.EMAIL_CRED_KEY;
  if (b64 == null || String(b64).trim() === '') {
    throw new Error(
      'EMAIL_CRED_KEY is missing — set a 32-byte key as base64 (e.g. from Secret Manager)'
    );
  }
  let key;
  try {
    key = Buffer.from(String(b64).trim(), 'base64');
  } catch (err) {
    throw new Error('EMAIL_CRED_KEY is not valid base64');
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `EMAIL_CRED_KEY must decode to ${KEY_BYTES} bytes (got ${key.length})`
    );
  }
  return key;
}

/**
 * @param {string} plaintext
 * @returns {{ v: number, iv: string, tag: string, data: string }}
 */
function encrypt(plaintext) {
  if (typeof plaintext !== 'string') {
    throw new Error('encrypt() expects a string plaintext');
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    v: PAYLOAD_VERSION,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

/**
 * @param {{ v?: number, iv?: string, tag?: string, data?: string }|null|undefined} payload
 * @returns {string}
 */
function decrypt(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('decrypt() expects a payload object');
  }
  if (payload.v != null && Number(payload.v) !== PAYLOAD_VERSION) {
    throw new Error(`Unsupported credential payload version: ${payload.v}`);
  }
  if (!payload.iv || !payload.tag || !payload.data) {
    throw new Error('decrypt() payload missing iv, tag, or data');
  }
  const key = getKey();
  const iv = Buffer.from(String(payload.iv), 'base64');
  const tag = Buffer.from(String(payload.tag), 'base64');
  const data = Buffer.from(String(payload.data), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = {
  encrypt,
  decrypt,
  PAYLOAD_VERSION,
};
