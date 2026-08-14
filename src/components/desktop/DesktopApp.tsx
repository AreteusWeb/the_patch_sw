/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useWebSocket } from '../../hooks/useWebSocket';
import useStore from '../../store/useStore';
import SideMenu from '../SideMenu';
import EventBanner from '../EventBanner';
import DesktopPatientBar from './DesktopPatientBar';
import DesktopLeftSidebar from './DesktopLeftSidebar';
import DesktopCentralArea from './DesktopCentralArea';
import DesktopRightSidebar from './DesktopRightSidebar';
import DesktopStatusBar from './DesktopStatusBar';
import FitnessLeftSidebar from './FitnessLeftSidebar';
import FitnessCentralArea from './FitnessCentralArea';
import FitnessRightSidebar from './FitnessRightSidebar';
import AiCoachPanel from './AiCoachPanel';

/**
 * DesktopApp Component.
 * Areteus "The Patch" desktop dashboard with two layouts:
 * - Normal (clinical): vitals | multi-lead ECG | AI clinical
 * - Fitness: training metrics | ECG+zones | recovery / AI coach
 * AI Coach opens as a resizable right column (not an overlay).
 */
export default function DesktopApp() {
  const { waveforms } = useWebSocket();
  const desktopLayout = useStore(s => s.desktopLayout);
  const isFitness = desktopLayout === 'fitness';
  const [coachOpen, setCoachOpen] = useState(false);

  const mainContent = isFitness ? (
    <>
      <FitnessLeftSidebar waveforms={waveforms} />
      <FitnessCentralArea waveforms={waveforms} />
      <FitnessRightSidebar waveforms={waveforms} />
    </>
  ) : (
    <>
      <DesktopLeftSidebar waveforms={waveforms} />
      <DesktopCentralArea waveforms={waveforms} />
      <DesktopRightSidebar waveforms={waveforms} />
    </>
  );

  return (
    <div className="h-screen bg-black text-slate-100 font-sans selection:bg-teal-500/30 overflow-hidden flex flex-col">
      <DesktopPatientBar
        coachOpen={coachOpen}
        onToggleCoach={() => setCoachOpen((v) => !v)}
      />

      <div className="flex justify-center px-2">
        <EventBanner />
      </div>

      <Group
        orientation="horizontal"
        className="flex-1 min-h-0"
        id="desktop-main-coach"
      >
        <Panel
          id="desktop-main"
          minSize="40%"
          className="min-w-0"
        >
          <div className="flex h-full min-h-0 min-w-0">{mainContent}</div>
        </Panel>

        {coachOpen && (
          <>
            <Separator
              className="w-1.5 bg-slate-800 hover:bg-teal-500/50 active:bg-teal-500/70 transition-colors data-[separator]:cursor-col-resize"
              title="Drag to resize AI Coach"
            />
            <Panel
              id="desktop-coach"
              defaultSize="30%"
              minSize="20%"
              maxSize="60%"
              className="min-w-0"
            >
              <AiCoachPanel onClose={() => setCoachOpen(false)} />
            </Panel>
          </>
        )}
      </Group>

      <DesktopStatusBar />

      <AnimatePresence>
        <SideMenu key="side-menu" />
      </AnimatePresence>

      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-[100] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />

      <div className="fixed inset-0 pointer-events-none opacity-10 z-[-1]">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-teal-900/20 blur-[120px] rounded-full" />
      </div>
    </div>
  );
}
