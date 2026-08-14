import React, { useState, useEffect } from 'react';
import { X, User, Mail, Lock, Cpu, Check, ChevronRight, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { backdropMotion, drawerMotion } from '../utils/motionPresets';
import {
  updateProfile,
  updateEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from 'firebase/auth';
import { doc, updateDoc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import useStore from '../store/useStore';
import { API_BASE } from '../lib/appConfig';

/**
 * Properties for the ProfileDrawer component.
 */
interface ProfileDrawerProps {
  /** Indicates whether the profile drawer is open. */
  open: boolean;
  /** Callback function to close the profile drawer. */
  onClose: () => void;
}

type Section = 'name' | 'email' | 'password' | 'mac' | 'ota' | null;

/**
 * Normalizes a raw MAC address string into the standard XX:XX:XX:XX:XX:XX format.
 * Returns null if the address is invalid.
 */
function normalizeMac(raw: string): string | null {
  const clean = raw.replace(/[^A-Fa-f0-9]/g, '');
  if (clean.length !== 12) return null;
  return clean.match(/.{2}/g)!.join(':').toUpperCase();
}

/**
 * ProfileDrawer Component.
 * Displays a drawer to edit the user's name, email, password, linked device MAC address,
 * and to trigger a firmware (OTA) update for the linked device.
 */
const ProfileDrawer: React.FC<ProfileDrawerProps> = ({ open, onClose }) => {
  const { currentUser, deviceMac, setDeviceMac } = useStore();
  const [activeSection, setActiveSection] = useState<Section>(null);

  // Field states
  const [name,        setName]        = useState('');
  const [email,       setEmail]       = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [currentPass, setCurrentPass] = useState('');
  const [mac,         setMac]         = useState('');

  // UI states
  const [loading,  setLoading]  = useState(false);
  const [success,  setSuccess]  = useState<string | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  // ── OTA state ────────────────────────────────────────────────────────────
  // "latestVersion" is read from a Firestore document maintained by the
  // company (config/firmware). When they release a new version, no frontend
  // redeploy is needed — they only update that document.
  const [currentFwVersion, setCurrentFwVersion] = useState<string | null>(null);
  const [latestFwVersion,  setLatestFwVersion]  = useState<string | null>(null);
  const [otaStatus, setOtaStatus] = useState<'idle' | 'checking' | 'triggering' | 'sent' | 'error'>('idle');
  const [otaError,  setOtaError]  = useState<string | null>(null);

  // Pre-fill on open
  useEffect(() => {
    if (open && currentUser) {
      setName(currentUser.displayName ?? '');
      setEmail(currentUser.email ?? '');
      setMac(deviceMac ?? '');
      setActiveSection(null);
      setSuccess(null);
      setError(null);
      setOtaStatus('idle');
      setOtaError(null);

      // Fetch user's current version + latest version published by the company
      (async () => {
        try {
          const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
          setCurrentFwVersion(userSnap.data()?.lastOtaTriggeredVersion ?? null);

          const configSnap = await getDoc(doc(db, 'config', 'firmware'));
          setLatestFwVersion(configSnap.data()?.latestVersion ?? null);
        } catch {
          // If config/firmware does not exist yet, simply do not show "latest"
        }
      })();
    }
  }, [open, currentUser, deviceMac]);

  const reset = () => {
    setError(null);
    setSuccess(null);
    setCurrentPass('');
    setNewPassword('');
    setOtaError(null);
  };

  const toggle = (section: Section) => {
    setActiveSection(prev => prev === section ? null : section);
    reset();
  };

  // ── Save handlers ───────────────────────────────────────────────────────────

  const saveName = async () => {
    if (!currentUser || !name.trim()) return;
    setLoading(true); setError(null);
    try {
      await updateProfile(currentUser, { displayName: name.trim() });
      await updateDoc(doc(db, 'users', currentUser.uid), { displayName: name.trim() });
      setSuccess('Name updated.');
      setActiveSection(null);
    } catch {
      setError('Could not update name.');
    } finally { setLoading(false); }
  };

  const saveEmail = async () => {
    if (!currentUser || !email.trim() || !currentPass) return;
    setLoading(true); setError(null);
    try {
      const credential = EmailAuthProvider.credential(currentUser.email!, currentPass);
      await reauthenticateWithCredential(currentUser, credential);
      await updateEmail(currentUser, email.trim());
      await updateDoc(doc(db, 'users', currentUser.uid), { email: email.trim() });
      setSuccess('Email updated.');
      setActiveSection(null);
      setCurrentPass('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setError('Current password is incorrect.');
      } else {
        setError('Could not update email.');
      }
    } finally { setLoading(false); }
  };

  const savePassword = async () => {
    if (!currentUser || !newPassword || !currentPass) return;
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setLoading(true); setError(null);
    try {
      const credential = EmailAuthProvider.credential(currentUser.email!, currentPass);
      await reauthenticateWithCredential(currentUser, credential);
      await updatePassword(currentUser, newPassword);
      setSuccess('Password updated.');
      setActiveSection(null);
      setCurrentPass('');
      setNewPassword('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('wrong-password') || msg.includes('invalid-credential')) {
        setError('Current password is incorrect.');
      } else {
        setError('Could not update password.');
      }
    } finally { setLoading(false); }
  };

  const saveMac = async () => {
    if (!currentUser) return;
    const normalized = normalizeMac(mac);
    if (!normalized) { setError('Invalid MAC address. Expected format: 58:8C:81:56:41:78'); return; }
    setLoading(true); setError(null);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), { deviceMac: normalized });
      setDeviceMac(normalized);
      setSuccess('Device MAC updated. Reconnect to apply changes.');
      setActiveSection(null);
    } catch {
      setError('Could not update device MAC.');
    } finally { setLoading(false); }
  };

  // ── OTA trigger ──────────────────────────────────────────────────────────
  const triggerOta = async () => {
    if (!currentUser || !deviceMac || !latestFwVersion) return;
    setOtaStatus('triggering');
    setOtaError(null);
    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_BASE}/api/ota/trigger`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ mac: deviceMac, version: latestFwVersion }),
      });
      const data = await res.json();

      if (!res.ok) {
        const messages: Record<string, string> = {
          device_offline: 'Your device is not connected right now. Try again once it\u2019s online.',
          not_owner: 'This device is not linked to your account.',
          firmware_not_found: 'This firmware version is not available yet.',
        };
        setOtaError(messages[data.error] ?? 'Could not start the update.');
        setOtaStatus('error');
        return;
      }

      setCurrentFwVersion(data.version);
      setOtaStatus('sent');
    } catch {
      setOtaError('Network error — could not reach the server.');
      setOtaStatus('error');
    }
  };

  // ── Input shared styles ─────────────────────────────────────────────────────
  const inputCls =
    'w-full bg-slate-900/80 border border-slate-700/80 text-[#F5F5F5] text-[13px] rounded-2xl pl-10 pr-4 py-2.5 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 transition-all placeholder:text-[#6B7280] disabled:opacity-50 font-mono leading-[1.45]';
  const saveBtnCls =
    'w-full mt-3 bg-teal-500 hover:bg-teal-400 active:bg-teal-600 text-slate-950 text-[10px] font-bold py-2.5 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed uppercase tracking-widest';

  const upToDate = currentFwVersion && latestFwVersion && currentFwVersion === latestFwVersion;

  const rows: { key: Section; label: string; icon: React.ElementType; value: string }[] = [
    { key: 'name',     label: 'Display name', icon: User,      value: currentUser?.displayName ?? '—' },
    { key: 'email',    label: 'Email',         icon: Mail,      value: currentUser?.email ?? '—' },
    { key: 'password', label: 'Password',      icon: Lock,      value: '••••••••' },
    { key: 'mac',      label: 'Device MAC',    icon: Cpu,       value: deviceMac ?? 'Not set' },
    { key: 'ota',      label: 'Firmware',      icon: RefreshCw, value: currentFwVersion ?? '—' },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="profile-backdrop"
            initial={backdropMotion.initial}
            animate={backdropMotion.animate}
            exit={backdropMotion.exit}
            transition={backdropMotion.transition}
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-md"
            onClick={onClose}
          />

          <motion.div
            key="profile-drawer"
            initial={drawerMotion.initial}
            animate={drawerMotion.animate}
            exit={drawerMotion.exit}
            transition={drawerMotion.transition}
            className="fixed right-0 top-0 h-full w-full max-w-[28rem] sm:max-w-[32rem] z-[70] flex flex-col bg-slate-950/95 backdrop-blur-2xl shadow-2xl border-l border-slate-800/80"
          >
            {/* Header — same family as AI Coach */}
            <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-slate-800/80 flex-shrink-0 gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.22em]">
                  Account
                </p>
                <p className="text-base font-bold text-[#F5F5F5] mt-0.5 truncate leading-tight">
                  Profile
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 p-0.5 rounded-xl bg-slate-900/50 border border-slate-800/90">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-[#A0A0A8] hover:text-[#F5F5F5] hover:bg-slate-800/80 transition-colors"
                  aria-label="Close profile"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <AnimatePresence>
              {success && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mx-5 mt-4 flex items-center gap-2 px-3.5 py-2.5 bg-teal-500/10 border border-teal-500/25 rounded-xl"
                >
                  <Check size={13} className="text-teal-400 flex-shrink-0" />
                  <p className="text-[12px] text-teal-400 leading-[1.45]">{success}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex-1 overflow-y-auto scrollbar-hide px-5 py-5 space-y-2">
              {rows.map(({ key, label, icon: Icon, value }) => (
                <div
                  key={key}
                  className="rounded-2xl border border-slate-700/60 bg-slate-800/40 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    className="flex items-center gap-3 w-full px-3.5 py-3 hover:bg-slate-800/60 transition-colors group"
                  >
                    <div className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-900/60 text-[#A0A0A8] border border-slate-700/50 group-hover:text-teal-400 transition-colors flex-shrink-0">
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-widest">
                        {label}
                      </p>
                      <p className="text-[13px] text-[#F5F5F5] truncate mt-0.5 leading-[1.45]">
                        {value}
                      </p>
                    </div>
                    <ChevronRight
                      size={14}
                      className={`text-[#6B7280] transition-transform flex-shrink-0 ${
                        activeSection === key ? 'rotate-90' : ''
                      }`}
                    />
                  </button>

                  <AnimatePresence>
                    {activeSection === key && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="px-3.5 pb-3.5 pt-2 border-t border-slate-700/50 space-y-2">
                          {error && activeSection === key && (
                            <p className="text-[11px] text-rose-400 px-1 leading-[1.45]">{error}</p>
                          )}

                          {key === 'name' && (
                            <>
                              <div className="relative">
                                <User size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" disabled={loading} className={inputCls} />
                              </div>
                              <button type="button" onClick={saveName} disabled={loading || !name.trim()} className={saveBtnCls}>
                                {loading ? 'Saving…' : 'Save name'}
                              </button>
                            </>
                          )}

                          {key === 'email' && (
                            <>
                              <div className="relative">
                                <Mail size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="New email" disabled={loading} className={inputCls} />
                              </div>
                              <div className="relative">
                                <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                                <input type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="Current password" disabled={loading} className={inputCls} />
                              </div>
                              <button type="button" onClick={saveEmail} disabled={loading || !email.trim() || !currentPass} className={saveBtnCls}>
                                {loading ? 'Saving…' : 'Save email'}
                              </button>
                            </>
                          )}

                          {key === 'password' && (
                            <>
                              <div className="relative">
                                <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                                <input type="password" value={currentPass} onChange={e => setCurrentPass(e.target.value)} placeholder="Current password" disabled={loading} className={inputCls} />
                              </div>
                              <div className="relative">
                                <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="New password" disabled={loading} className={inputCls} />
                              </div>
                              <button type="button" onClick={savePassword} disabled={loading || !currentPass || !newPassword} className={saveBtnCls}>
                                {loading ? 'Saving…' : 'Save password'}
                              </button>
                            </>
                          )}

                          {key === 'mac' && (
                            <>
                              <div className="relative">
                                <Cpu size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#6B7280]" />
                                <input type="text" value={mac} onChange={e => setMac(e.target.value)} placeholder="58:8C:81:56:41:78" disabled={loading} spellCheck={false} className={inputCls} />
                              </div>
                              <p className="text-[10px] text-[#6B7280] px-1 leading-[1.45]">Found on the label of your device</p>
                              <button type="button" onClick={saveMac} disabled={loading || !mac} className={saveBtnCls}>
                                {loading ? 'Saving…' : 'Save MAC'}
                              </button>
                            </>
                          )}

                          {key === 'ota' && (
                            <>
                              {!deviceMac && (
                                <p className="text-[11px] text-[#6B7280] px-1 leading-[1.45]">Link a device MAC first to update its firmware.</p>
                              )}

                              {deviceMac && (
                                <>
                                  <div className="flex items-center justify-between px-1 text-[11px]">
                                    <span className="text-[#6B7280]">Current version</span>
                                    <span className="text-[#A0A0A8] font-mono">{currentFwVersion ?? '—'}</span>
                                  </div>
                                  <div className="flex items-center justify-between px-1 text-[11px]">
                                    <span className="text-[#6B7280]">Latest available</span>
                                    <span className="text-[#A0A0A8] font-mono">{latestFwVersion ?? '—'}</span>
                                  </div>

                                  {otaError && (
                                    <p className="text-[11px] text-rose-400 px-1 leading-[1.45]">{otaError}</p>
                                  )}
                                  {otaStatus === 'sent' && (
                                    <p className="text-[11px] text-teal-400 px-1 leading-[1.45]">Update sent to your device. It will install shortly.</p>
                                  )}

                                  <button
                                    type="button"
                                    onClick={triggerOta}
                                    disabled={otaStatus === 'triggering' || !latestFwVersion || !!upToDate}
                                    className={saveBtnCls}
                                  >
                                    {otaStatus === 'triggering'
                                      ? 'Sending update…'
                                      : upToDate
                                        ? 'Already up to date'
                                        : 'Update firmware'}
                                  </button>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ProfileDrawer;
