/**
 * db-provider.gcp.cjs — Real implementation (Firestore).
 * Reuses the same firebase-admin app as auth-provider.gcp.cjs
 * (avoids initializing it twice).
 */

const { admin } = require('./auth-provider.gcp.cjs');

const db = admin.firestore();

async function getDevicesByOwner(uid) {
  const snap = await db.collection('devices').where('ownerUid', '==', uid).get();
  return snap.docs.map(d => d.data());
}

async function getDeviceByMac(mac) {
  const ref = await db.collection('devices').doc(mac).get();
  return ref.exists ? ref.data() : null;
}

async function createDevice(device) {
  await db.collection('devices').doc(device.deviceMac).set(device);
}

async function deleteDevice(mac) {
  await db.collection('devices').doc(mac).delete();
}

async function getUser(uid) {
  const snap = await db.collection('users').doc(uid).get();
  return snap.exists ? snap.data() : null;
}

async function setUserOtaTriggered(uid, fields) {
  await db.collection('users').doc(uid).set(fields, { merge: true });
}

module.exports = {
  getDevicesByOwner,
  getDeviceByMac,
  createDevice,
  deleteDevice,
  getUser,
  setUserOtaTriggered,
};
