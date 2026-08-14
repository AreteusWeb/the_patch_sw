/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import Header from '../Header';
import VitalsDisplay from '../VitalsDisplay';
import ActivityStats from '../ActivityStats';
import AlertsPanel from '../AlertsPanel';
import WaveformContainer from '../WaveformContainer';
import AdvancedControls from '../AdvancedControls';
import SideMenu from '../SideMenu';
import Footer from '../Footer';
import MobileLiveBar from './MobileLiveBar';
import AiCoachPanel from '../desktop/AiCoachPanel';
import { useWebSocket } from '../../hooks/useWebSocket';
import useStore from '../../store/useStore';
import { backdropMotion, sheetMotion } from '../../utils/motionPresets';

/**
 * MobileApp Component.
 * Header stays pinned; content scrolls beneath it.
 * AI Coach opens as a full-screen sheet (not a split with the dashboard).
 */
export default function MobileApp() {
  const viewMode = useStore(state => state.viewMode);
  const { waveforms, bufferedSeconds } = useWebSocket();
  const [coachOpen, setCoachOpen] = useState(false);

  return (
    <div className="h-dvh bg-black text-slate-100 font-sans selection:bg-teal-500/30 overflow-hidden">
      <div className="max-w-md mx-auto relative flex flex-col h-full bg-black">
        {/* Pinned top bar — always visible (mode, connection, menu) */}
        <div className="flex-shrink-0 z-30 bg-black pt-[env(safe-area-inset-top)] border-b border-slate-900/80">
          <Header />
        </div>

        <main className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-hide bg-black">
          {viewMode === 'Normal' ? (
            <div className="flex flex-col animate-in fade-in duration-500 pb-3">
              <VitalsDisplay />
              <ActivityStats />
              <AlertsPanel />
              <WaveformContainer waveforms={waveforms} />
            </div>
          ) : (
            <div className="flex flex-col animate-in fade-in duration-500 pb-3">
              <VitalsDisplay compact />
              <AdvancedControls />
              <WaveformContainer waveforms={waveforms} />
            </div>
          )}
        </main>

        <div className="flex-shrink-0 bg-black">
          <MobileLiveBar bufferedSeconds={bufferedSeconds} />
          <Footer />
        </div>

        <AnimatePresence>
          <SideMenu
            key="side-menu"
            onOpenAiCoach={() => setCoachOpen(true)}
          />
        </AnimatePresence>

        <AnimatePresence>
          {coachOpen && (
            <>
              <motion.div
                key="mobile-coach-backdrop"
                initial={backdropMotion.initial}
                animate={backdropMotion.animate}
                exit={backdropMotion.exit}
                transition={backdropMotion.transition}
                className="fixed inset-0 z-[75] max-w-md mx-auto bg-black/55 backdrop-blur-md"
                onClick={() => setCoachOpen(false)}
              />
              <motion.div
                key="mobile-coach"
                initial={sheetMotion.initial}
                animate={sheetMotion.animate}
                exit={sheetMotion.exit}
                transition={sheetMotion.transition}
                className="fixed inset-0 z-[80] max-w-md mx-auto bg-black flex flex-col origin-bottom"
              >
                <AiCoachPanel
                  onClose={() => setCoachOpen(false)}
                  presentation="fullscreen"
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
