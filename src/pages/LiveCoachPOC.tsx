/**
 * LiveCoachPOC — isolated Gemini Live API page.
 * Open at: http://localhost:3000/live-coach-poc
 */

import React from 'react';
import LiveCoachSessionView from '../components/desktop/LiveCoachSessionView';

const LiveCoachPOC: React.FC = () => {
  return (
    <div className="min-h-screen bg-slate-950 text-[#F5F5F5] flex flex-col">
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.22em]">
            Isolated POC
          </p>
          <h1 className="text-lg font-bold mt-0.5">Gemini Live Coach</h1>
        </div>
        <p className="text-[11px] text-[#6B7280] text-right max-w-xs">
          No Firestore · No /api/coach/message · 3 min hard limit
        </p>
      </header>

      <main className="flex-1 px-6 py-6 flex flex-col max-w-3xl mx-auto w-full min-h-0">
        <LiveCoachSessionView />
        <a
          href="/"
          className="mt-4 text-[12px] text-[#6B7280] hover:text-teal-400 underline underline-offset-2 w-fit"
        >
          Back to app
        </a>
      </main>
    </div>
  );
};

export default LiveCoachPOC;
