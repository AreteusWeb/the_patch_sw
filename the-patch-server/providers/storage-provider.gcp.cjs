/**
 * storage-provider.gcp.cjs — Real implementation (Google Cloud Storage).
 * Only backend file that knows GCS exists.
 */

const { Storage } = require('@google-cloud/storage');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `[storage-provider.gcp] Missing environment variable ${name}. ` +
      'Set it in your .env (see .env.example) or use APP_MODE=local to save to disk.'
    );
  }
  return value;
}

const BUCKET_NAME = requireEnv('GCS_BUCKET_NAME');
const FIRMWARE_BUCKET_NAME = process.env.FIRMWARE_BUCKET_NAME || BUCKET_NAME;

const storage = new Storage();
const bucket = storage.bucket(BUCKET_NAME);
const firmwareBucket = storage.bucket(FIRMWARE_BUCKET_NAME);

const OTA_URL_EXPIRY_MS = 60 * 60 * 1000;

async function saveChunk(path, payload) {
  await bucket.file(path).save(payload, { contentType: 'application/json' });
  return { location: `gs://${BUCKET_NAME}/${path}` };
}

/**
 * Upload a binary blob (e.g. coach Voice & Video recording) to GCS.
 * Uses COACH_RECORDINGS_BUCKET_NAME when set; otherwise falls back to GCS_BUCKET_NAME.
 *
 * @param {string} storagePath object path inside the bucket
 * @param {Buffer} buffer
 * @param {string} [contentType]
 * @returns {Promise<{ storagePath: string, location: string }>}
 */
async function saveBinaryFile(storagePath, buffer, contentType = 'application/octet-stream') {
  const recordingsBucketName =
    process.env.COACH_RECORDINGS_BUCKET_NAME || BUCKET_NAME;
  const recordingsBucket = storage.bucket(recordingsBucketName);
  await recordingsBucket.file(storagePath).save(buffer, {
    contentType: contentType || 'application/octet-stream',
    resumable: false,
  });
  return {
    storagePath,
    location: `gs://${recordingsBucketName}/${storagePath}`,
  };
}

async function getFirmwareDownloadUrl(firmwarePath) {
  const file = firmwareBucket.file(firmwarePath);
  const [exists] = await file.exists();
  if (!exists) return { exists: false };

  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + OTA_URL_EXPIRY_MS,
  });
  return { exists: true, url: signedUrl };
}

module.exports = { saveChunk, saveBinaryFile, getFirmwareDownloadUrl, BUCKET_NAME };
