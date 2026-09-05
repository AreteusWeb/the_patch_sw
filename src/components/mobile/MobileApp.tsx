/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
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

/** Soft keyboard usually shrinks the visual viewport by more than this. */
const KEYBOARD_OPEN_PX = 120;

const headerMotion = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit: { height: 0, opacity: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const },
};

/**
 * MobileApp Component.
 * Dashboard (vitals/ECG) and AI Coach are exclusive on mobile so the soft
 * keyboard can sit cleanly under the composer — no split-pane collapse /
 * black gap when focusing the text field.
 */
export default function MobileApp() {
  const viewMode = useStore(state => state.viewMode);
  const { waveforms, bufferedSeconds } = useWebSocket();
  const [coachOpen, setCoachOpen] = useState(false);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Pin the shell to the visual viewport (iOS offsetTop + Android keyboard).
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      const top = Math.round(vv.offsetTop);
      const height = Math.round(vv.height);
      document.documentElement.style.setProperty('--mobile-vv-top', `${top}px`);
      document.documentElement.style.setProperty('--mobile-vvh', `${height}px`);
      setKeyboardOpen(window.innerHeight - height > KEYBOARD_OPEN_PX);

      // Stop the browser from scrolling the document when focusing the composer.
      if (window.scrollY !== 0) window.scrollTo(0, 0);
      if (document.documentElement.scrollTop !== 0) {
        document.documentElement.scrollTop = 0;
      }
    };

    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      document.documentElement.style.removeProperty('--mobile-vv-top');
      document.documentElement.style.removeProperty('--mobile-vvh');
    };
  }, []);

  const hideHeader = coachOpen && keyboardOpen;

  return (
    <div
      className="bg-black text-slate-100 font-sans selection:bg-teal-500/30 overflow-hidden fixed left-0 right-0 box-border"
      style={{
        top: 'var(--mobile-vv-top, 0px)',
        height: 'var(--mobile-vvh, 100dvh)',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        transition: 'height 0.22s ease, top 0.22s ease',
      }}
    >
      <div className="max-w-md mx-auto relative flex flex-col h-full bg-black">
        <AnimatePresence initial={false}>
          {!hideHeader && (
            <motion.div
              key="mobile-header"
              initial={headerMotion.initial}
              animate={headerMotion.animate}
              exit={headerMotion.exit}
              transition={headerMotion.transition}
              className="flex-shrink-0 z-30 bg-black border-b border-slate-900/80 overflow-hidden"
            >
              <Header
                coachOpen={coachOpen}
                onToggleCoach={() => setCoachOpen((v) => !v)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {coachOpen ? (
          <motion.div
            layout
            className="flex-1 min-h-0 overflow-hidden"
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <AiCoachPanel
              onClose={() => setCoachOpen(false)}
              presentation="embedded"
            />
          </motion.div>
        ) : (
          <>
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
            <div className="flex-shrink-0 bg-black z-20">
              <MobileLiveBar bufferedSeconds={bufferedSeconds} />
              {/* Shell already pads home indicator — keep footer spacing light */}
              <Footer />
            </div>
          </>
        )}

        <AnimatePresence>
          <SideMenu
            key="side-menu"
            onOpenAiCoach={() => setCoachOpen(true)}
          />
        </AnimatePresence>
      </div>
    </div>
  );
}
