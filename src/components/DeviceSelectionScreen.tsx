import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Plus, Trash2, LogOut, Activity, X, Check, AlertCircle, Smartphone } from 'lucide-react';
import { doc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { IS_LOCAL_MODE, AUTO_LOGIN_ENABLED } from '../lib/appConfig';
import useStore from '../store/useStore';
import { logout } from '../hooks/useAuth';
import { cn } from '../utils/cn';

// ─── Local mode: device list stored in localStorage ────────────────────────
// In cloud mode this list lives in Firestore (users/{uid}.devices). In local
// mode there is no Firestore, so it is persisted in the browser — enough for
// local dev/testing (not synced across devices, and lost if you clear browser
// localStorage).
const LOCAL_DEVICES_KEY = 'thepatch_local_devices';

function loadLocalDevices(): Device[] {
  try {
    const raw = localStorage.getItem(LOCAL_DEVICES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalDevices(devices: Device[]) {
  localStorage.setItem(LOCAL_DEVICES_KEY, JSON.stringify(devices));
}

/**
 * Normalizes a raw MAC address string into the standard XX:XX:XX:XX:XX:XX format.
 * Returns null if the address is invalid.
 */
function normalizeMac(raw: string): string | null {
  const clean = raw.replace(/[^A-Fa-f0-9]/g, '');
  if (clean.length !== 12) return null;
  return clean.match(/.{2}/g)!.join(':').toUpperCase();
}

interface Device {
  name: string;
  mac: string;
}

export default function DeviceSelectionScreen() {
  const currentUser = useStore((s) => s.currentUser);
  const setDeviceMac = useStore((s) => s.setDeviceMac);
  const setIsDeviceSelected = useStore((s) => s.setIsDeviceSelected);

  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Device Modal State
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMac, setNewMac] = useState('');
  const [modalError, setModalError] = useState<string | null>(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Delete Confirmation State
  const [confirmDeleteMac, setConfirmDeleteMac] = useState<string | null>(null);

  // Subscribe to user document to load and sync devices
  useEffect(() => {
    if (!currentUser) return;

    if (IS_LOCAL_MODE) {
      setDevices(loadLocalDevices());
      setLoading(false);
      return;
    }

    const userRef = doc(db!, 'users', currentUser.uid);

    const unsub = onSnapshot(
      userRef,
      async (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setDevices(data.devices || []);
        }
        setLoading(false);
      },
      (error) => {
        console.error('[DeviceSelection] Error fetching user document:', error);
        setLoading(false);
      }
    );

    return () => unsub();
  }, [currentUser]);

  // Handle Connecting / Selecting a device
  const handleConnect = (mac: string) => {
    setDeviceMac(mac);
    setIsDeviceSelected(true);
  };

  // Handle adding a new device to Firestore
  const handleAddDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    setModalError(null);
    if (!newName.trim()) {
      setModalError('Please enter a device name.');
      return;
    }

    const normalized = normalizeMac(newMac);
    if (!normalized) {
      setModalError('Invalid MAC address. Expected format: 58:8C:81:56:41:78');
      return;
    }

    // Check if MAC is already registered in the list
    if (devices.some((d) => d.mac === normalized)) {
      setModalError('This MAC address is already registered.');
      return;
    }

    setModalLoading(true);
    try {
      const updatedDevices = [...devices, { name: newName.trim(), mac: normalized }];

      if (IS_LOCAL_MODE) {
        saveLocalDevices(updatedDevices);
      } else {
        const userRef = doc(db!, 'users', currentUser.uid);
        await updateDoc(userRef, { devices: updatedDevices });
      }
      setDevices(updatedDevices);

      // Reset form & Close modal
      setNewName('');
      setNewMac('');
      setShowAddModal(false);
    } catch (err: unknown) {
      console.error('[DeviceSelection] Failed to add device:', err);
      setModalError('Failed to add device. Please try again.');
    } finally {
      setModalLoading(false);
    }
  };

  // Handle deleting a device (localStorage in local mode, Firestore in cloud mode)
  const handleDeleteDevice = async (macToDelete: string) => {
    if (!currentUser) return;
    try {
      const updatedDevices = devices.filter((d) => d.mac !== macToDelete);

      if (IS_LOCAL_MODE) {
        saveLocalDevices(updatedDevices);
      } else {
        const userRef = doc(db!, 'users', currentUser.uid);
        await updateDoc(userRef, { devices: updatedDevices });
      }
      setDevices(updatedDevices);
      setConfirmDeleteMac(null);
    } catch (err) {
      console.error('[DeviceSelection] Failed to delete device:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden font-sans flex flex-col justify-between selection:bg-teal-500/30">

      {/* ── BACKGROUND ART ─────────────────────────────────────────────────── */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-teal-600/10 rounded-full blur-[140px] pointer-events-none animate-pulse" style={{ animationDuration: '8s' }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-600/8 rounded-full blur-[140px] pointer-events-none animate-pulse" style={{ animationDuration: '12s' }} />

      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #f8fafc 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(20,184,166,0.08),rgba(16,185,129,0.04),rgba(20,184,166,0.08))] bg-[length:100%_3px,4px_100%]" />

      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <header className="w-full max-w-7xl mx-auto px-4 sm:px-6 pt-5 sm:pt-8 pb-3 sm:pb-4 flex items-center justify-between z-10 relative">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400">
            <Activity size={16} className="sm:hidden animate-pulse" />
            <Activity size={20} className="hidden sm:block animate-pulse" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-base sm:text-xl font-black text-white tracking-[0.2em] uppercase leading-none">
              Areteus
            </h1>
            <span className="text-[8px] sm:text-[9px] font-bold text-teal-400 tracking-[0.35em] uppercase whitespace-nowrap mt-1 leading-none">
              The Patch
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!AUTO_LOGIN_ENABLED) void logout();
          }}
          disabled={AUTO_LOGIN_ENABLED}
          title={
            AUTO_LOGIN_ENABLED
              ? 'Sign out disabled during auto-login testing'
              : 'Sign out'
          }
          className={cn(
            'flex items-center gap-1.5 border text-[10px] sm:text-xs font-bold uppercase tracking-wider px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all shadow-md',
            AUTO_LOGIN_ENABLED
              ? 'bg-slate-900/40 border-slate-800/50 text-slate-600 cursor-not-allowed opacity-50 pointer-events-none'
              : 'bg-slate-900/60 hover:bg-rose-500/10 border-slate-800/80 hover:border-rose-500/20 text-slate-400 hover:text-rose-400 active:scale-95'
          )}
        >
          <LogOut size={12} />
          Sign Out
        </button>
      </header>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      <main className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-8 flex-1 flex flex-col z-10 relative">

        {/* Title Panel — Add Device as compact secondary control beside the title */}
        <div className="flex items-start sm:items-center justify-between gap-3 pb-5 sm:pb-7 border-b border-slate-800/60">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-xl sm:text-3xl md:text-4xl font-extrabold tracking-tight text-white uppercase bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-400">
                My Devices
              </h2>
              <button
                onClick={() => setShowAddModal(true)}
                className="sm:hidden flex items-center justify-center w-8 h-8 rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 transition-all active:scale-95 shrink-0 shadow-md shadow-teal-500/25"
                title="Add Device"
                aria-label="Add Device"
              >
                <Plus size={16} strokeWidth={2.5} />
              </button>
            </div>
            <p className="text-[10px] sm:text-xs text-slate-400 font-semibold tracking-wider mt-3 sm:mt-4 uppercase flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
              Select a device to start monitoring
            </p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="hidden sm:flex items-center justify-center gap-1.5 bg-teal-500/15 hover:bg-teal-500/25 border border-teal-500/40 hover:border-teal-400/60 text-teal-300 hover:text-teal-200 font-bold px-3 py-2 rounded-xl transition-all text-[10px] uppercase tracking-widest active:scale-95 shrink-0"
          >
            <Plus size={13} strokeWidth={2.5} />
            Add Device
          </button>
        </div>

        {/* Device Grid — vertically centered so few devices don't leave a dead hole at the bottom */}
        <div className="flex-1 flex flex-col justify-center min-h-[240px] pt-5 sm:pt-7">
          {loading ? (
            <div className="flex flex-col items-center gap-4 py-12 sm:py-20">
              <div className="w-8 h-8 border-2 border-teal-500/20 border-t-teal-400 rounded-full animate-spin" />
              <p className="text-[9px] sm:text-[10px] text-slate-500 font-bold uppercase tracking-[0.25em]">
                Retrieving active devices...
              </p>
            </div>
          ) : devices.length === 0 ? (
            <div className="text-center py-10 sm:py-14 bg-slate-900/80 border border-slate-800/60 rounded-2xl p-5 sm:p-8 max-w-md mx-auto shadow-2xl">
              <div className="w-11 h-11 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500 mb-4">
                <Cpu size={20} />
              </div>
              <h3 className="text-sm sm:text-lg font-bold text-white uppercase tracking-wider">No Devices Configured</h3>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-2 leading-relaxed font-medium">
                We couldn't find any devices linked to this account. Tap + to add one.
              </p>
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-4 inline-flex items-center gap-1.5 bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-[10px] uppercase tracking-widest active:scale-95"
              >
                <Plus size={14} strokeWidth={2.5} />
                Add Device
              </button>
            </div>
          ) : (
            <div className="w-full max-w-2xl md:max-w-none mx-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                {devices.map((device) => {
                  const isDeleting = confirmDeleteMac === device.mac;

                  return (
                    <div
                      key={device.mac}
                      className="bg-slate-900/90 border border-slate-800/80 hover:border-teal-500/30 rounded-xl p-3 sm:p-3.5 shadow-xl flex flex-col gap-2.5 transition-colors duration-300 group relative overflow-hidden"
                    >
                      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-teal-500 to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                      {/* Row 1: name + Available pill */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-teal-500/5 border border-teal-500/10 flex items-center justify-center text-teal-400 shrink-0">
                            <Cpu size={16} />
                          </div>
                          <h4 className="text-sm font-bold text-white group-hover:text-teal-400 transition-colors truncate">
                            {device.name}
                          </h4>
                        </div>

                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-950/80 border border-slate-800 text-[8px] sm:text-[9px] font-bold text-teal-400 shadow-inner uppercase tracking-wider shrink-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                          Available
                        </span>
                      </div>

                      {/* Row 2: MAC + actions in one tight block */}
                      {!isDeleting ? (
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest shrink-0">
                              MAC
                            </span>
                            <code className="font-mono text-[10px] sm:text-[11px] font-semibold text-teal-300 bg-teal-950/30 border border-teal-800/30 px-1.5 py-0.5 rounded truncate">
                              {device.mac}
                            </code>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleConnect(device.mac)}
                              className="flex-1 h-11 bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-teal-500/30 text-slate-200 hover:text-white font-bold px-3 rounded-lg text-[10px] uppercase tracking-widest transition-all active:scale-[0.98]"
                            >
                              Open Monitor
                            </button>
                            <button
                              onClick={() => setConfirmDeleteMac(device.mac)}
                              className="w-11 h-11 flex items-center justify-center rounded-lg bg-slate-950/60 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/20 text-slate-500 hover:text-rose-400 transition-all shrink-0"
                              title="Delete Device"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 bg-rose-500/5 border border-rose-500/10 rounded-lg p-1.5 h-11">
                          <p className="text-[8px] font-bold text-rose-400 uppercase tracking-wider pl-2 flex-grow">
                            Delete?
                          </p>
                          <button
                            onClick={() => handleDeleteDevice(device.mac)}
                            className="bg-rose-500 hover:bg-rose-400 text-white font-bold px-3 py-1.5 rounded-md text-[8px] uppercase tracking-wider transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteMac(null)}
                            className="bg-slate-900 border border-slate-800 text-slate-400 hover:text-white font-bold px-3 py-1.5 rounded-md text-[8px] uppercase tracking-wider transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-center text-[9px] text-slate-600 font-semibold uppercase tracking-[0.2em] mt-5 sm:mt-6">
                Tap + to register another device
              </p>
            </div>
          )}
        </div>
      </main>

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-6 text-center z-10 relative border-t border-slate-900/60">
        <p className="text-[8px] sm:text-[9px] text-slate-600 font-bold uppercase tracking-[0.3em]">
          &copy; {new Date().getFullYear()} Areteus Systems. ECG MONITORING LAYERS.
        </p>
      </footer>

      {/* ── ADD DEVICE MODAL ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: 'spring', damping: 24, stiffness: 260 }}
              className="bg-slate-900/95 border border-slate-800/80 rounded-2xl sm:rounded-3xl p-5 sm:p-6 md:p-8 max-w-md w-full shadow-2xl relative"
            >
              {/* Modal Close Button */}
              <button
                onClick={() => setShowAddModal(false)}
                className="absolute top-4 right-4 sm:top-6 sm:right-6 w-8 h-8 flex items-center justify-center rounded-full bg-slate-950 border border-slate-850 hover:bg-slate-800 hover:text-white text-slate-400 transition-all"
              >
                <X size={15} />
              </button>

              {/* Modal Header */}
              <div className="mb-4 sm:mb-6 flex items-center gap-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center">
                  <Smartphone size={16} />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white uppercase tracking-wide">Add Device</h3>
                  <p className="text-[8px] sm:text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                    Register a new Patch monitor
                  </p>
                </div>
              </div>

              {/* Modal Form */}
              <form onSubmit={handleAddDevice} className="space-y-3 sm:space-y-4">
                {/* Device Name input */}
                <div className="space-y-1.5">
                  <label className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                    Device Name
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="The Patch 1"
                    required
                    disabled={modalLoading}
                    className="w-full bg-slate-950/60 border border-slate-800 text-slate-200 text-xs sm:text-sm rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60 font-medium"
                  />
                </div>

                {/* MAC Address input */}
                <div className="space-y-1.5">
                  <label className="text-[8px] sm:text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                    MAC Address
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-3 sm:pl-4 flex items-center pointer-events-none">
                      <Cpu size={14} className="text-slate-600 group-focus-within:text-teal-450 transition-colors" />
                    </div>
                    <input
                      type="text"
                      value={newMac}
                      onChange={(e) => setNewMac(e.target.value)}
                      placeholder="58:8C:81:56:41:78"
                      required
                      disabled={modalLoading}
                      spellCheck={false}
                      autoCapitalize="characters"
                      className="w-full bg-slate-950/60 border border-slate-800 text-slate-250 text-xs sm:text-sm rounded-xl pl-10 sm:pl-11 pr-3 sm:pr-4 py-2.5 sm:py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60 font-mono tracking-widest"
                    />
                  </div>
                  <p className="text-[8px] text-slate-500 ml-1 tracking-wider uppercase font-medium">
                    Enter the physical MAC address on your device label.
                  </p>
                </div>

                {/* Error Banner */}
                {modalError && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3 flex items-start gap-2.5"
                  >
                    <AlertCircle size={15} className="text-rose-450 shrink-0 mt-0.5" />
                    <p className="text-[9px] font-bold text-rose-400 uppercase tracking-wider">
                      {modalError}
                    </p>
                  </motion.div>
                )}

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="w-full bg-gradient-to-r from-teal-400 to-emerald-400 hover:from-teal-300 hover:to-emerald-300 text-slate-950 font-bold py-3 sm:py-4 rounded-xl transition-all shadow-md shadow-teal-500/10 hover:shadow-teal-500/20 flex items-center justify-center gap-2 mt-4 sm:mt-6 text-[10px] sm:text-xs uppercase tracking-widest relative overflow-hidden disabled:opacity-50"
                >
                  {modalLoading ? (
                    <div className="w-5 h-5 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                  ) : (
                    <>
                      Save Device
                      <Check size={14} strokeWidth={2.5} />
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
