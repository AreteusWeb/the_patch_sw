/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import Header from '../Header';
import VitalsDisplay from '../VitalsDisplay';
import ActivityStats from '../ActivityStats';
import AlertsPanel from '../AlertsPanel';
import WaveformContainer from '../WaveformContainer';
import AdvancedControls from '../AdvancedControls';
import SideMenu from '../SideMenu';
import Footer from '../Footer';
import MobileLiveBar from './MobileLiveBar';
import { useWebSocket } from '../../hooks/useWebSocket';
import useStore from '../../store/useStore';
import { AnimatePresence } from 'motion/react';

/**
 * MobileApp Component.
 * MOBILE layout — this is exactly the design that was already approved.
 * Same JSX that previously lived directly in App.tsx, now in its own file
 * so we can branch to DesktopApp without touching this design.
 */
export default function MobileApp() {
  const viewMode = useStore(state => state.viewMode);
  // Own the socket/history here so scrubbing keeps working across Normal/Advanced
  const { waveforms } = useWebSocket();

  return (
    <div className="min-h-screen bg-black text-slate-100 font-sans selection:bg-teal-500/30 overflow-y-auto scrollbar-hide">
      <div className="max-w-md mx-auto relative flex flex-col min-h-screen border-x border-slate-900 shadow-2xl bg-black">
        <Header />

        <main className="flex-1 flex flex-col pb-2 min-h-0">
          {viewMode === 'Normal' ? (
            <div className="flex flex-col animate-in fade-in duration-500 flex-1">
              <VitalsDisplay />
              <ActivityStats />
              <AlertsPanel />
              <WaveformContainer waveforms={waveforms} />
            </div>
          ) : (
            <div className="flex flex-col animate-in fade-in duration-500 flex-1">
              <VitalsDisplay compact />
              <AdvancedControls />
              <WaveformContainer waveforms={waveforms} />
            </div>
          )}
        </main>

        {/* Same live/scrub model as desktop — works in Normal and Advanced */}
        <MobileLiveBar />

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
