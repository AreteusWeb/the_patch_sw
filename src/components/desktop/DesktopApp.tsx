/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AnimatePresence } from 'motion/react';
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

/**
 * DesktopApp Component.
 * Dashboard de escritorio Areteus "The Patch" con dos layouts:
 * - Normal (clinical): vitals | multi-lead ECG | AI clinical
 * - Fitness: training metrics | ECG+zones | recovery / AI coach
 */
export default function DesktopApp() {
  const { waveforms } = useWebSocket();
  const desktopLayout = useStore(s => s.desktopLayout);
  const isFitness = desktopLayout === 'fitness';

  return (
    <div className="h-screen bg-black text-slate-100 font-sans selection:bg-teal-500/30 overflow-hidden flex flex-col">
      <DesktopPatientBar />

      <div className="flex justify-center px-2">
        <EventBanner />
      </div>

      <div className="flex flex-1 min-h-0">
        {isFitness ? (
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
        )}
      </div>

      <DesktopStatusBar />

      <AnimatePresence>
        <SideMenu key="side-menu" />
      </AnimatePresence>

      {/* Scan-line overlay — mismo efecto que mobile */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-[100] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]" />

      <div className="fixed inset-0 pointer-events-none opacity-10 z-[-1]">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-teal-900/20 blur-[120px] rounded-full" />
      </div>
    </div>
  );
}
