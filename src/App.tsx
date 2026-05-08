/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import Header from './components/Header';
import VitalsDisplay from './components/VitalsDisplay';
import ActivityStats from './components/ActivityStats';
import AlertsPanel from './components/AlertsPanel';
import WaveformContainer from './components/WaveformContainer';
import BottomNav from './components/BottomNav';
import AdvancedControls from './components/AdvancedControls';
import EventBanner from './components/EventBanner';
import SideMenu from './components/SideMenu';
import Footer from './components/Footer';
import useStore from './store/useStore';
import { AnimatePresence } from 'motion/react';

export default function App() {
  const viewMode = useStore(state => state.viewMode);

  return (
    <div className="min-h-screen bg-black text-slate-100 font-sans selection:bg-teal-500/30 overflow-y-auto scrollbar-hide">
      <div className="max-w-md mx-auto relative flex flex-col min-h-screen border-x border-slate-900 shadow-2xl bg-black">
        <Header />
        
        <main className="flex-1 flex flex-col pb-2">
          {viewMode === 'Normal' ? (
            <div className="flex flex-col animate-in fade-in duration-500 flex-1">
              <VitalsDisplay />
              <ActivityStats />
              <AlertsPanel />
              <WaveformContainer />
            </div>
          ) : (
            <div className="flex flex-col animate-in fade-in duration-500 flex-1">
              <VitalsDisplay compact />
              <EventBanner />
              <AdvancedControls />
              <WaveformContainer />
            </div>
          )}
        </main>

        <AnimatePresence>
          <SideMenu key="side-menu" />
        </AnimatePresence>

        <Footer />

        {/* Professional medical scan-line overlay effect */}
        <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-[100] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />
        
        {/* Global background glow */}
        <div className="fixed inset-0 pointer-events-none opacity-10 z-[-1]">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-teal-900/30 blur-[100px] rounded-full" />
        </div>
      </div>
    </div>
  );
}
