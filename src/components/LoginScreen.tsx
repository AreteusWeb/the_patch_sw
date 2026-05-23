import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  Mail,
  Lock,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';

import { sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { login } from '../hooks/useAuth';
import RegisterScreen from './RegisterScreen';

// ─── LoginScreen ─────────────────────────────────────────────────────────────


export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Enter your email above first.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
      setError(null);
    } catch {
      setError('Could not send reset email. Check the address and try again.');
    }
  };

  if (showRegister) {
    return <RegisterScreen onBackToLogin={() => setShowRegister(false)} />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError(null);
    setLoading(true);

    try {
      await login(email.trim(), password);

      // onAuthStateChanged en useAuth actualiza el store → App.tsx cambia de vista
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Authentication failed';

      // Simplificar mensajes Firebase
      if (
        msg.includes('invalid-credential') ||
        msg.includes('wrong-password') ||
        msg.includes('user-not-found')
      ) {
        setError('Invalid email or password.');
      } else if (msg.includes('too-many-requests')) {
        setError('Too many attempts. Please try again later.');
      } else {
        setError('Could not sign in. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center px-6 relative overflow-hidden font-sans">
      {/* Ambient background glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-teal-500/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/5 rounded-full blur-[120px] pointer-events-none" />

      {/* Subtle grid */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'radial-gradient(circle, white 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md z-10"
      >
        {/* Logo / Brand */}
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
            <p className="text-xl font-medium text-slate-200">
              Sign in
            </p>

            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.3em] mt-1">
              Real-time monitoring
            </p>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-slate-900/40 backdrop-blur-xl border border-white/5 rounded-3xl p-8 shadow-2xl">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Email */}
            <div className="space-y-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                Email
              </label>

              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail
                    size={16}
                    className="text-slate-600 group-focus-within:text-teal-400 transition-colors"
                  />
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
                  <Lock
                    size={16}
                    className="text-slate-600 group-focus-within:text-teal-400 transition-colors"
                  />
                </div>

                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  disabled={loading}
                  className="w-full bg-slate-950/50 border border-slate-800 text-slate-200 text-base rounded-2xl pl-11 pr-4 py-3 focus:outline-none focus:border-teal-500/50 focus:ring-1 focus:ring-teal-500/20 transition-all placeholder:text-slate-700 disabled:opacity-60"
                />
              </div>
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

            {/* Button */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              className={`
                w-full
                bg-teal-400
                hover:bg-teal-300
                text-black
                font-bold
                py-4
                rounded-2xl
                transition-all
                shadow-lg
                shadow-teal-500/20
                flex
                items-center
                justify-center
                gap-2
                mt-4
                text-xs
                uppercase
                tracking-widest
                overflow-hidden
                relative
                disabled:opacity-50
                disabled:cursor-not-allowed
              `}
            >
              <div className="z-10 flex items-center gap-2">
                {loading ? (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <>
                    Sign in
                    <ChevronRight size={16} />
                  </>
                )}
              </div>

              {/* Shine effect */}
              {!loading && (
                <motion.div
                  animate={{ left: ['-100%', '200%'] }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                  className="absolute top-0 w-1/2 h-full bg-white/20 skew-x-12 blur-xl"
                />
              )}
            </button>
          </form>

          {/* Forgot password */}
          <div className="mt-4 text-center">
            {resetSent ? (
              <p className="text-[10px] text-teal-400 font-bold uppercase tracking-widest">
                Reset email sent ✓
              </p>
            ) : (
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-[10px] font-bold text-slate-600 uppercase tracking-widest hover:text-slate-400 transition-colors"
              >
                Forgot password?
              </button>
            )}
          </div>

          {/* Create account link — igual que antes */}
          <div className="mt-3 text-center">
            <button
              onClick={() => setShowRegister(true)}
              className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hover:text-teal-400 transition-colors"
            >
              New user? Create account →
            </button>
          </div>

          
        </div>
      </motion.div>
    </div>
  );
}