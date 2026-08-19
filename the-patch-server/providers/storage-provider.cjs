/**
 * storage-provider.cjs — ECG chunk storage wrapper/adapter.
 *
 * server.cjs only knows these generic functions. The real implementation
 * (Google Cloud Storage or local disk) is selected here based on APP_MODE.
 * When switching to S3, Supabase Storage, etc., only add a new
 * `storage-provider.<x>.cjs` — server.cjs stays untouched.
 */

const APP_MODE = (process.env.APP_MODE || 'cloud').toLowerCase();

let impl;
if (APP_MODE === 'local') {
  impl = require('./storage-provider.local.cjs');
} else {
  impl = require('./storage-provider.gcp.cjs');
}

module.exports = {
  /** Saves a data chunk (string payload) at `path`. */
  saveChunk: impl.saveChunk,
  /**
   * Saves a binary file (Buffer) at `storagePath`.
   * Cloud: COACH_RECORDINGS_BUCKET_NAME (or GCS_BUCKET_NAME fallback).
   * Local: LOCAL_RECORDINGS_DIR (or local-data/coach-recordings).
   */
  saveBinaryFile: impl.saveBinaryFile,
  /**
   * Returns a signed (or local) URL to download a firmware file.
   * @returns {Promise<{ exists: boolean, url?: string }>}
   */
  getFirmwareDownloadUrl: impl.getFirmwareDownloadUrl,
};
