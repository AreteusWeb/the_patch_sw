'use strict';
/**
 * Email monitor module config. Not wired into server.cjs yet (Phase 1).
 * EMAIL_MONITOR_ENABLED defaults off — nothing in this folder is imported by the server.
 */

const EMAIL_MONITOR_ENABLED =
  String(process.env.EMAIL_MONITOR_ENABLED || '').trim().toLowerCase() === 'true';

/** IMAP connect + operation budget (ms). */
const IMAP_TIMEOUT_MS = Math.max(
  1000,
  Number.parseInt(process.env.EMAIL_IMAP_TIMEOUT_MS || '15000', 10) || 15000
);

module.exports = {
  EMAIL_MONITOR_ENABLED,
  IMAP_TIMEOUT_MS,
};
