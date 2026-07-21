import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cpu, Plus, Trash2, LogOut, Activity, X, Check, AlertCircle, Smartphone } from 'lucide-react';
import { doc, onSnapshot, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import useStore from '../store/useStore';
import { logout } from '../hooks/useAuth';

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

    const userRef = doc(db, 'users', currentUser.uid);

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
      const userRef = doc(db, 'users', currentUser.uid);
      const updatedDevices = [...devices, { name: newName.trim(), mac: normalized }];
      await updateDoc(userRef, { devices: updatedDevices });

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

  // Handle deleting a device from Firestore
  const handleDeleteDevice = async (macToDelete: string) => {
    if (!currentUser) return;
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      const updatedDevices = devices.filter((d) => d.mac !== macToDelete);
      await updateDoc(userRef, { devices: updatedDevices });
      setConfirmDeleteMac(null);
    } catch (err) {
      console.error('[DeviceSelection] Failed to delete device:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 relative overflow-hidden font-sans flex flex-col justify-between selection:bg-teal-500/30">

      {/* ── BACKGROUND ART ─────────────────────────────────────────────────── */}
      {/* Elegant, dynamic background glowing spheres */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-teal-600/10 rounded-full blur-[140px] pointer-events-none animate-pulse" style={{ animationDuration: '8s' }} />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-emerald-600/8 rounded-full blur-[140px] pointer-events-none animate-pulse" style={{ animationDuration: '12s' }} />

      {/* Subtle radial dot grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, #f8fafc 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* High-tech glassmorphism grid overlay for depth */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02] z-50 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(20,184,166,0.08),rgba(16,185,129,0.04),rgba(20,184,166,0.08))] bg-[length:100%_3px,4px_100%]" />

      {/* ── HEADER ───────────────────────────────────────────────────────────── */}
      <header className="w-full max-w-7xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between z-10 relative">
        <div className="flex items-center gap-3">
          {/* Pulsing ECG line visual indicator */}
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400">
            <Activity size={20} className="animate-pulse" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-black text-white tracking-[0.2em] uppercase leading-none">
              Areteus
            </h1>
            <span className="text-[9px] font-bold text-teal-400 tracking-[0.4em] uppercase whitespace-nowrap mt-1 leading-none">
              The Patch
            </span>
          </div>
        </div>

        <button
          onClick={() => logout()}
          className="flex items-center gap-2 bg-slate-900/60 hover:bg-rose-500/10 border border-slate-800/80 hover:border-rose-500/20 text-slate-400 hover:text-rose-400 text-xs font-bold uppercase tracking-wider px-4 py-2.5 rounded-xl transition-all shadow-md active:scale-95"
        >
          <LogOut size={13} />
          Sign Out
        </button>
      </header>

      {/* ── MAIN CONTENT ─────────────────────────────────────────────────────── */}
      <main className="w-full max-w-7xl mx-auto px-6 py-8 flex-1 flex flex-col justify-center z-10 relative">

        {/* Title Panel */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-6 border-b border-slate-800/60">
          <div>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white uppercase bg-clip-text text-transparent bg-gradient-to-r from-white via-slate-100 to-slate-400">
              My Devices
            </h2>
            <p className="text-xs text-slate-400 font-semibold tracking-wider mt-2 uppercase flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-ping" />
              Select a device to start monitoring in real-time
            </p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-teal-400 to-emerald-400 hover:from-teal-300 hover:to-emerald-300 text-slate-950 font-bold px-6 py-3.5 rounded-2xl transition-all shadow-lg shadow-teal-500/10 hover:shadow-teal-500/25 text-xs uppercase tracking-widest active:scale-95"
          >
            <Plus size={15} strokeWidth={2.5} />
            Add Device
          </button>
        </div>

        {/* Device Grid */}
        <div className="flex-1 flex flex-col justify-center min-h-[350px]">
          {loading ? (
            <div className="flex flex-col items-center gap-4 py-20">
              <div className="w-9 h-9 border-2 border-teal-500/20 border-t-teal-400 rounded-full animate-spin" />
              <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.25em]">
                Retrieving active devices...
              </p>
            </div>
          ) : devices.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center py-16 bg-slate-900/20 backdrop-blur-md border border-slate-800/60 rounded-3xl p-8 max-w-md mx-auto shadow-2xl"
            >
              <div className="w-14 h-14 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center mx-auto text-slate-500 mb-5">
                <Cpu size={24} />
              </div>
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">No Devices Configured</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed font-medium">
                We couldn't find any devices linked to this account. Click **Add Device** above to get started.
              </p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 py-8">
              {devices.map((device) => {
                const isDeleting = confirmDeleteMac === device.mac;

                return (
                  <motion.div
                    key={device.mac}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ type: 'spring', damping: 20 }}
                    className="bg-slate-900/40 backdrop-blur-xl border border-slate-800/80 hover:border-teal-500/30 rounded-2xl p-6 shadow-2xl flex flex-col justify-between transition-all duration-300 group hover:-translate-y-1 hover:shadow-[0_12px_30px_rgba(20,184,166,0.05)] relative overflow-hidden"
                  >
                    {/* Glowing highlight top border line */}
                    <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-teal-500 to-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                    {/* Card Header Info */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-teal-500/5 border border-teal-500/10 flex items-center justify-center text-teal-400 group-hover:bg-teal-500/10 group-hover:border-teal-500/20 transition-all shrink-0">
                          <Cpu size={22} />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-base font-bold text-white group-hover:text-teal-400 transition-colors truncate">
                            {device.name}
                          </h4>
                          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider block mt-0.5">
                            Status
                          </span>
                        </div>
                      </div>

                      {/* Status badge */}
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-950/80 border border-slate-800 text-[9px] font-bold text-teal-400 shadow-inner uppercase tracking-wider">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
                        Available
                      </span>
                    </div>

                    {/* Monospace MAC Tag */}
                    <div className="mt-6 flex items-center gap-2">
                      <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                        MAC Address:
                      </span>
                      <code className="font-mono text-xs font-semibold text-teal-300 bg-teal-950/30 border border-teal-800/30 px-2.5 py-1 rounded-lg">
                        {device.mac}
                      </code>
                    </div>

                    {/* Bottom Action buttons */}
                    <div className="mt-8 pt-4 border-t border-slate-900 flex items-center gap-3">
                      {!isDeleting ? (
                        <>
                          <button
                            onClick={() => handleConnect(device.mac)}
                            className="flex-grow bg-slate-950 hover:bg-slate-900 border border-slate-850 hover:border-teal-500/30 text-slate-200 hover:text-white font-bold py-3 px-4 rounded-xl text-xs uppercase tracking-widest transition-all shadow-md active:scale-95"
                          >
                            Open Monitor
                          </button>
                          <button
                            onClick={() => setConfirmDeleteMac(device.mac)}
                            className="w-12 h-12 flex items-center justify-center rounded-xl bg-slate-950/60 hover:bg-rose-500/10 border border-slate-850 hover:border-rose-500/20 text-slate-500 hover:text-rose-400 transition-all shrink-0"
                            title="Delete Device"
                          >
                            <Trash2 size={16} />
                          </button>
                        </>
                      ) : (
                        <div className="w-full flex items-center gap-2 bg-rose-500/5 border border-rose-500/10 rounded-xl p-1.5 animate-in fade-in duration-200">
                          <p className="text-[9px] font-bold text-rose-400 uppercase tracking-wider pl-2 flex-grow">
                            Delete device?
                          </p>
                          <button
                            onClick={() => handleDeleteDevice(device.mac)}
                            className="bg-rose-500 hover:bg-rose-400 text-white font-bold px-3 py-2 rounded-lg text-[9px] uppercase tracking-wider transition-colors"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDeleteMac(null)}
                            className="bg-slate-900 border border-slate-850 text-slate-400 hover:text-white font-bold px-3 py-2 rounded-lg text-[9px] uppercase tracking-wider transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer className="w-full max-w-7xl mx-auto px-6 py-6 text-center z-10 relative border-t border-slate-900/60">
        <p className="text-[9px] text-slate-650 font-bold uppercase tracking-[0.3em]">
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
              className="bg-slate-900/95 border border-slate-800/80 rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl relative"
            >
              {/* Modal Close Button */}
              <button
                onClick={() => setShowAddModal(false)}
                className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center rounded-full bg-slate-950 border border-slate-850 hover:bg-slate-800 hover:text-white text-slate-400 transition-all"
              >
                <X size={15} />
              </button>

              {/* Modal Header */}
              <div className="mb-6 flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center">
                  <Smartphone size={18} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white uppercase tracking-wide">Add Device</h3>
                  <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">
                    Register a new ChestPad monitor
                  </p>
                </div>
              </div>

              {/* Modal Form */}
              <form onSubmit={handleAddDevice} className="space-y-4">
                {/* Device Name input */}
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                    Device Name
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="The Patch 1"
                    required
                    disabled={modalLoading}
                    className="w-full bg-slate-950/60 border border-slate-800 text-slate-200 text-sm rounded-xl px-4 py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60 font-medium"
                  />
                </div>

                {/* MAC Address input */}
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                    MAC Address
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
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
                      className="w-full bg-slate-950/60 border border-slate-800 text-slate-250 text-sm rounded-xl pl-11 pr-4 py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60 font-mono tracking-widest"
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
                  className="w-full bg-gradient-to-r from-teal-400 to-emerald-400 hover:from-teal-300 hover:to-emerald-300 text-slate-950 font-bold py-4 rounded-xl transition-all shadow-md shadow-teal-500/10 hover:shadow-teal-500/20 flex items-center justify-center gap-2 mt-6 text-xs uppercase tracking-widest relative overflow-hidden disabled:opacity-50"
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
