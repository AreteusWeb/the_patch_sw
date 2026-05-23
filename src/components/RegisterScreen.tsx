import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Mail, Lock, User, Cpu, ChevronRight, ShieldCheck } from 'lucide-react';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

interface RegisterScreenProps {
  onBackToLogin: () => void;
}

// Normaliza MAC: acepta con o sin separadores → XX:XX:XX:XX:XX:XX
function normalizeMac(raw: string): string | null {
  const clean = raw.replace(/[^A-Fa-f0-9]/g, '');
  if (clean.length !== 12) return null;
  return clean.match(/.{2}/g)!.join(':').toUpperCase();
}

export default function RegisterScreen({ onBackToLogin }: RegisterScreenProps) {
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [mac,      setMac]      = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalizedMac = normalizeMac(mac);
    if (!normalizedMac) {
      setError('Invalid MAC address. Expected format: 58:8C:81:56:41:78');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    setLoading(true);
    try {
      // 1. Crear cuenta en Firebase Auth
      const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);

      // 2. Guardar displayName en el perfil Auth
      await updateProfile(user, { displayName: name.trim() });

      // 3. Crear documento users/{uid} en Firestore
      // La MAC se guarda una sola vez — useAuth la carga automáticamente en cada login
      await setDoc(doc(db, 'users', user.uid), {
        email:       email.trim(),
        displayName: name.trim(),
        createdAt:   serverTimestamp(),
        deviceMac:   normalizedMac,
      });

      // onAuthStateChanged en useAuth detecta el nuevo usuario → dashboard
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('email-already-in-use')) {
        setError('An account with this email already exists.');
      } else if (msg.includes('invalid-email')) {
        setError('Invalid email address.');
      } else if (msg.includes('weak-password')) {
        setError('Password must be at least 6 characters.');
      } else {
        setError('Could not create account. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const isReady = name && email && password && mac && !loading;

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 relative overflow-hidden font-sans">
      {/* Ambient glows — mismos que LoginScreen */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-teal-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize:  '28px 28px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md z-10"
      >
        {/* Brand — idéntico al LoginScreen */}
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="mb-4 flex flex-col items-center">
            <h1 className="text-4xl font-black text-white tracking-[0.2em] uppercase leading-none mr-[-0.2em]">
              Areteus
            </h1>
            <div className="flex items-center justify-center gap-3 mt-3 w-full">
              <div className="h-[1px] flex-1 bg-teal-500/30 max-w-[40px]" />
              <h2 className="text-lg font-bold text-teal-400 tracking-[0.4em] uppercase whitespace-nowrap mr-[-0.4em]">
                ChestPad
              </h2>
              <div className="h-[1px] flex-1 bg-teal-500/30 max-w-[40px]" />
            </div>
          </div>

          <div className="mt-8">
            <p className="text-xl font-medium text-slate-200">Create account</p>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em] mt-1">
              Set up your monitoring profile
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Name */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                Full name
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <User size={16} className="text-slate-600 group-focus-within:text-teal-400 transition-colors" />
                </div>
                <input
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Steve Rogers"
                  required
                  disabled={loading}
                  className="w-full bg-slate-950/50 border border-slate-800 text-slate-200 text-base rounded-2xl pl-11 pr-4 py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                Email
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail size={16} className="text-slate-600 group-focus-within:text-teal-400 transition-colors" />
                </div>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  required
                  disabled={loading}
                  className="w-full bg-slate-950/50 border border-slate-800 text-slate-200 text-base rounded-2xl pl-11 pr-4 py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                Password
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock size={16} className="text-slate-600 group-focus-within:text-teal-400 transition-colors" />
                </div>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={loading}
                  className="w-full bg-slate-950/50 border border-slate-800 text-slate-200 text-base rounded-2xl pl-11 pr-4 py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60"
                />
              </div>
            </div>

            {/* MAC Address */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                Device MAC address
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Cpu size={16} className="text-slate-600 group-focus-within:text-teal-400 transition-colors" />
                </div>
                <input
                  type="text"
                  value={mac}
                  onChange={e => setMac(e.target.value)}
                  placeholder="58:8C:81:56:41:78"
                  required
                  disabled={loading}
                  spellCheck={false}
                  autoCapitalize="characters"
                  className="w-full bg-slate-950/50 border border-slate-800 text-slate-200 text-base rounded-2xl pl-11 pr-4 py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60 font-mono tracking-wider"
                />
              </div>
              <p className="text-[9px] text-slate-600 ml-1 tracking-wide">
                Found on the label of your ChestPad device
              </p>
            </div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3"
              >
                <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider text-center">
                  {error}
                </p>
              </motion.div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={!isReady}
              className="w-full bg-teal-400 hover:bg-teal-300 text-black font-bold py-4 rounded-2xl transition-all shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2 mt-2 text-xs uppercase tracking-widest overflow-hidden relative disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <div className="z-10 flex items-center gap-2">
                {loading ? (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <>
                    Create account
                    <ChevronRight size={16} />
                  </>
                )}
              </div>

              {/* Shine effect — igual que LoginScreen */}
              {!loading && (
                <motion.div
                  animate={{ left: ['-100%', '200%'] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  className="absolute top-0 w-1/2 h-full bg-white/20 skew-x-12 blur-xl"
                />
              )}
            </button>
          </form>

          {/* Back to login */}
          <div className="mt-6 text-center">
            <button
              onClick={onBackToLogin}
              disabled={loading}
              className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-teal-400 transition-colors disabled:opacity-40"
            >
              ← Back to sign in
            </button>
          </div>

          
        </div>
      </motion.div>
    </div>
  );
}
