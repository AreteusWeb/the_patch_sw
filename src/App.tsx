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

/**
 * App Component.
 * Entry point de la interfaz. Maneja auth/loading (compartido) y decide
 * qué árbol de presentación renderizar — MobileApp o DesktopApp — según
 * el ancho del viewport. Ambos consumen los mismos hooks de datos
 * (useWebSocket, useStore, useFirestore), así que la lógica de negocio
 * vive en un solo lugar y nunca se duplica entre las dos capas visuales.
 */
export default function App() {
  useAuth();   // mounts the Firebase Auth listener (once)
  const currentUser = useStore(s => s.currentUser);
  const authLoading = useStore(s => s.authLoading);
  const isDeviceSelected = useStore(s => s.isDeviceSelected);
  useFirestore();

  const isDesktop = useIsDesktop();

  // ── Mientras Firebase verifica la sesión (igual en mobile y desktop) ───────
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

  if (!isDeviceSelected) {
    return <DeviceSelectionScreen />;
  }

  // ── A partir de aquí, la capa visual se bifurca ─────────────────────────────
  return isDesktop ? <DesktopApp /> : <MobileApp />;
}
