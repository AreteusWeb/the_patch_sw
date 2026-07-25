/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import useStore from './store/useStore';
import { useFirestore } from './hooks/useFirestore';
import { useAuth } from './hooks/useAuth';
import { useIsDesktop } from './hooks/useIsDesktop';
import LoginScreen from './components/LoginScreen';
import MobileApp from './components/mobile/MobileApp';
import DesktopApp from './components/desktop/DesktopApp';
import DeviceSelectionScreen from './components/DeviceSelectionScreen';
import { DEV_SHOW_ANY_DEVICE } from './lib/appConfig';

/**
 * App Component.
 * UI entry point. Handles shared auth/loading and chooses which presentation
 * tree to render — MobileApp or DesktopApp — based on viewport width. Both
 * consume the same data hooks (useWebSocket, useStore, useFirestore), so
 * business logic lives in one place and is never duplicated across the two
 * visual layers.
 */
export default function App() {
  useAuth();   // mounts the Firebase Auth listener (once)
  const currentUser = useStore(s => s.currentUser);
  const authLoading = useStore(s => s.authLoading);
  const isDeviceSelected = useStore(s => s.isDeviceSelected);
  useFirestore();

  const isDesktop = useIsDesktop();

  // ── While Firebase verifies the session (same on mobile and desktop) ───────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-3xl font-black text-white tracking-[0.2em] uppercase">Areteus</h1>
          <div className="flex items-center gap-3">
            <div className="h-[1px] w-8 bg-teal-500/40" />
            <span className="text-sm font-bold text-teal-400 tracking-[0.4em] uppercase">ChestPad</span>
            <div className="h-[1px] w-8 bg-teal-500/40" />
          </div>
        </div>
        <div className="w-7 h-7 border-2 border-teal-500/20 border-t-teal-400 rounded-full animate-spin" />
        <p className="text-[9px] text-slate-600 font-bold uppercase tracking-[0.3em]">Loading…</p>
      </div>
    );
  }

  if (currentUser === null) {
    return <LoginScreen />;
  }

  if (!isDeviceSelected && !DEV_SHOW_ANY_DEVICE) {
    return <DeviceSelectionScreen />;
  }

  // ── From here, the visual layer branches ────────────────────────────────────
  return isDesktop ? <DesktopApp /> : <MobileApp />;
}
