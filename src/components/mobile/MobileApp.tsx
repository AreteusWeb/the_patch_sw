/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { Sparkles } from 'lucide-react';
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
import { cn } from '../../utils/cn';

/**
 * MobileApp Component.
 * Header stays pinned; vitals/ECG scroll in the top pane.
 * AI Coach opens as a resizable bottom pane (both stay visible) via a FAB.
 */
export default function MobileApp() {
  const viewMode = useStore(state => state.viewMode);
  const { waveforms, bufferedSeconds } = useWebSocket();
  const [coachOpen, setCoachOpen] = useState(false);

  // Keep layout height tied to the visible viewport so the soft keyboard
  // doesn't blow up / crop the coach composer oddly.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const sync = () => {
      document.documentElement.style.setProperty(
        '--mobile-vvh',
        `${Math.round(vv.height)}px`
      );
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      document.documentElement.style.removeProperty('--mobile-vvh');
    };
  }, []);

  const mainScroll = (
    <main className="h-full min-h-0 overflow-y-auto overscroll-contain scrollbar-hide bg-black">
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
  );

  return (
    <div
      className="bg-black text-slate-100 font-sans selection:bg-teal-500/30 overflow-hidden"
      style={{ height: 'var(--mobile-vvh, 100dvh)' }}
    >
      <div className="max-w-md mx-auto relative flex flex-col h-full bg-black">
        {/* Pinned top bar — always visible (mode, connection, menu) */}
        <div className="flex-shrink-0 z-30 bg-black pt-[env(safe-area-inset-top)] border-b border-slate-900/80">
          <Header />
        </div>

        <Group
          orientation="vertical"
          className="flex-1 min-h-0"
          id="mobile-main-coach"
        >
          <Panel
            id="mobile-main"
            minSize={coachOpen ? '25%' : '100%'}
            defaultSize={coachOpen ? '45%' : '100%'}
            className="min-h-0"
          >
            {mainScroll}
          </Panel>

          {coachOpen && (
            <>
              <Separator
                className="h-2 flex-shrink-0 bg-slate-800 hover:bg-teal-500/50 active:bg-teal-500/70 transition-colors data-[separator]:cursor-row-resize"
                title="Drag to resize AI Coach"
              />
              <Panel
                id="mobile-coach"
                defaultSize="55%"
                minSize="35%"
                maxSize="75%"
                className="min-h-0 overflow-hidden border-t border-slate-800/80"
              >
                <AiCoachPanel
                  onClose={() => setCoachOpen(false)}
                  presentation="embedded"
                />
              </Panel>
            </>
          )}
        </Group>

        {/* Hide chrome while coach is open so keyboard + composer fit cleanly */}
        {!coachOpen && (
          <div className="flex-shrink-0 bg-black z-20">
            <MobileLiveBar bufferedSeconds={bufferedSeconds} />
            <Footer />
          </div>
        )}

        {/* Compact circular FAB */}
        {!coachOpen && (
          <button
            type="button"
            onClick={() => setCoachOpen(true)}
            className={cn(
              'absolute z-40 right-3',
              'bottom-[calc(5.5rem+env(safe-area-inset-bottom))]',
              'w-12 h-12 rounded-full',
              'flex items-center justify-center',
              'bg-teal-500 text-slate-950 shadow-[0_6px_18px_rgba(45,212,191,0.35)]',
              'hover:bg-teal-400 active:scale-[0.96] transition-all'
            )}
            aria-label="Open AI Coach"
            title="AI Coach"
          >
            <Sparkles size={18} strokeWidth={2.5} />
          </button>
        )}

        <AnimatePresence>
          <SideMenu key="side-menu" />
        </AnimatePresence>
      </div>
    </div>
  );
}
