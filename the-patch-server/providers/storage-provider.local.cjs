/**
 * storage-provider.local.cjs — Local implementation (disk).
 *
 * Used when APP_MODE=local. Saves ECG chunks as JSON files inside
 * LOCAL_STORAGE_DIR instead of uploading to GCS. No GCP account or
 * credentials required.
 *
 * NOTE (meeting priority #4): for the first local version this does not need
 * to work — the UI already shows live channels over WebSocket without going
 * through here. This implementation exists so the 10s pipeline does not fail
 * if it keeps running in parallel.
 */

const fs = require('fs');
const path = require('path');

const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || path.join(__dirname, '..', 'local-data', 'ecg-chunks');
const LOCAL_FIRMWARE_DIR = process.env.LOCAL_FIRMWARE_DIR || path.join(__dirname, '..', 'local-data', 'firmware');

function ensureDirFor(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function saveChunk(relativePath, payload) {
  const fullPath = path.join(LOCAL_STORAGE_DIR, relativePath);
  ensureDirFor(fullPath);
  fs.writeFileSync(fullPath, payload, 'utf8');
  return { location: fullPath };
}

async function getFirmwareDownloadUrl(firmwarePath) {
  const fullPath = path.join(LOCAL_FIRMWARE_DIR, firmwarePath);
  if (!fs.existsSync(fullPath)) return { exists: false };
  // Locally there are no signed URLs — exposed as file:// for manual testing;
  // the real OTA flow is not a priority in local mode.
  return { exists: true, url: `file://${fullPath}` };
}

module.exports = { saveChunk, getFirmwareDownloadUrl, LOCAL_STORAGE_DIR };
