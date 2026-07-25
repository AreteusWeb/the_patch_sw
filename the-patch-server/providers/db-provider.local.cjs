/**
 * db-provider.local.cjs — Local implementation (in-memory, no persistence).
 *
 * Used when APP_MODE=local. Data lives only while the process is running —
 * it is lost on restart. This is intentional: for meeting priority #4 (local
 * UI showing channels) persistence is not needed yet. If real local persistence
 * is wanted later, Postgres/SQLite/Supabase would be wired up here.
 */

const devicesByMac = new Map();
const usersByUid = new Map();

async function getDevicesByOwner(uid) {
  return [...devicesByMac.values()].filter(d => d.ownerUid === uid);
}

async function getDeviceByMac(mac) {
  return devicesByMac.get(mac) ?? null;
}

async function createDevice(device) {
  devicesByMac.set(device.deviceMac, device);
}

async function deleteDevice(mac) {
  devicesByMac.delete(mac);
}

async function getUser(uid) {
  return usersByUid.get(uid) ?? null;
}

async function setUserOtaTriggered(uid, fields) {
  usersByUid.set(uid, { ...(usersByUid.get(uid) || {}), ...fields });
}

module.exports = {
  getDevicesByOwner,
  getDeviceByMac,
  createDevice,
  deleteDevice,
  getUser,
  setUserOtaTriggered,
};
