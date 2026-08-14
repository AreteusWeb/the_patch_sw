import React from 'react';
import { useLiveCoachSession } from '../../hooks/useLiveCoachSession';
import { cn } from '../../utils/cn';

interface LiveCoachSessionViewProps {
  /** Compact layout for embedding inside AiCoachPanel */
  embedded?: boolean;
  className?: string;
}

/**
 * UI for Gemini Live voice+video session (shared by /live-coach-poc and AiCoachPanel).
 */
const LiveCoachSessionView: React.FC<LiveCoachSessionViewProps> = ({
  embedded = false,
  className,
}) => {
  const {
    phase,
    status,
    error,
    secondsLeft,
    hasPreview,
    youSaid,
    coachSaid,
    micLevel,
    videoRef,
    canvasRef,
    startSession,
    stopSession,
    LIVE_MODEL,
  } = useLiveCoachSession();

  return (
    <div
      className={cn(
        'flex flex-col min-h-0 text-[#F5F5F5]',
        embedded ? 'flex-1 gap-3' : 'gap-5',
        className
      )}
    >
      <div
        className={cn(
          'relative rounded-2xl overflow-hidden border border-slate-700/60 bg-slate-900',
          embedded ? 'aspect-video max-h-[40%] min-h-[140px] flex-shrink-0' : 'aspect-video'
        )}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="w-full h-full object-cover scale-x-[-1]"
        />
        {!hasPreview && phase !== 'live' && phase !== 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-[#6B7280] text-sm px-4 text-center">
            Camera preview appears when you start
          </div>
        )}
        {phase === 'live' && (
          <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-rose-500/90 text-[10px] font-bold uppercase tracking-wider">
            Live · {secondsLeft}s
          </div>
        )}
      </div>

      <canvas ref={canvasRef} className="hidden" />

      <div
        className={cn(
          'rounded-2xl border border-slate-800 bg-slate-900/50 px-4 py-3 space-y-2',
          embedded && 'flex-1 min-h-0 overflow-y-auto scrollbar-hide'
        )}
      >
        <p className="text-[12px] text-[#A0A0A8] leading-[1.45]">{status}</p>
        {phase === 'live' && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-[#6B7280]">
              Mic
            </span>
            <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-teal-400 transition-[width] duration-100"
                style={{ width: `${Math.round(micLevel * 100)}%` }}
              />
            </div>
          </div>
        )}
        {(youSaid || coachSaid) && (
          <div className="space-y-1.5 pt-1 border-t border-slate-800">
            {youSaid && (
              <p className="text-[12px] text-[#A0A0A8] leading-[1.45]">
                <span className="text-[#6B7280]">You: </span>
                {youSaid}
              </p>
            )}
            {coachSaid && (
              <p className="text-[12px] text-[#F5F5F5] leading-[1.45]">
                <span className="text-teal-400">Coach: </span>
                {coachSaid}
              </p>
            )}
          </div>
        )}
        {error && (
          <p className="text-[12px] text-rose-400 leading-[1.45]">{error}</p>
        )}
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
        {(phase === 'idle' || phase === 'ended' || phase === 'error') && (
          <button
            type="button"
            onClick={() => void startSession()}
            className="h-11 px-5 rounded-2xl bg-teal-500 text-slate-950 text-[12px] font-bold uppercase tracking-wider hover:bg-teal-400 transition-colors"
          >
            Start session
          </button>
        )}
        {(phase === 'starting' || phase === 'live') && (
          <button
            type="button"
            onClick={stopSession}
            disabled={phase === 'starting'}
            className="h-11 px-5 rounded-2xl border border-rose-500/40 text-rose-400 text-[12px] font-bold uppercase tracking-wider hover:bg-rose-500/10 transition-colors disabled:opacity-40"
          >
            {phase === 'starting' ? 'Starting…' : 'Stop'}
          </button>
        )}
      </div>

      <p className="text-[11px] text-[#6B7280] leading-[1.5] flex-shrink-0">
        Voice + video · nothing saved · 3 min limit
        {!embedded && (
          <>
            {' '}
            · <code className="text-[#A0A0A8]">{LIVE_MODEL}</code>
          </>
        )}
      </p>
    </div>
  );
};

export default LiveCoachSessionView;
