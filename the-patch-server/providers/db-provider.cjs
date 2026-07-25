/**
 * db-provider.cjs — Database wrapper/adapter for `devices` and `users`.
 *
 * Meeting instruction: do NOT change the database yet — Firestore in the cloud
 * is still used. This wrapper exists so that when migration is decided (e.g.
 * to Postgres/Supabase), only a new `db-provider.<x>.cjs` is added. server.cjs
 * never calls Firestore directly.
 *
 * Interface:
 *   getDevicesByOwner(uid)              -> Promise<Array<device>>
 *   getDeviceByMac(mac)                 -> Promise<device | null>
 *   createDevice(device)                -> Promise<void>
 *   deleteDevice(mac)                   -> Promise<void>
 *   getUser(uid)                        -> Promise<userDoc | null>
 *   setUserOtaTriggered(uid, fields)    -> Promise<void>
 */

const APP_MODE = (process.env.APP_MODE || 'cloud').toLowerCase();

let impl;
if (APP_MODE === 'local') {
  impl = require('./db-provider.local.cjs');
} else {
  impl = require('./db-provider.gcp.cjs');
}

module.exports = {
  getDevicesByOwner: impl.getDevicesByOwner,
  getDeviceByMac: impl.getDeviceByMac,
  createDevice: impl.createDevice,
  deleteDevice: impl.deleteDevice,
  getUser: impl.getUser,
  setUserOtaTriggered: impl.setUserOtaTriggered,
};
