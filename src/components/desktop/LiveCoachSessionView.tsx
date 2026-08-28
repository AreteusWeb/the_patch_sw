import React from 'react';
import { Circle } from 'lucide-react';
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
    recordingSupported,
    isRecording,
    recordingClock,
    recordingNotice,
    isSavingRecording,
    toggleRecording,
  } = useLiveCoachSession();

  const canRecord = phase === 'live' && recordingSupported && !isSavingRecording;

  const actions = (
    <div className="flex flex-col gap-2 flex-shrink-0 w-full min-w-0">
      <div className="flex items-center gap-2.5 flex-wrap">
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

        {phase === 'live' && recordingSupported && (
          <button
            type="button"
            onClick={toggleRecording}
            disabled={!canRecord && !isRecording}
            className={cn(
              'h-11 px-4 rounded-2xl text-[12px] font-bold uppercase tracking-wider transition-colors inline-flex items-center gap-2 disabled:opacity-40',
              isRecording
                ? 'bg-rose-500 text-white'
                : 'border border-rose-500/50 text-rose-400 hover:bg-rose-500/10'
            )}
            aria-pressed={isRecording}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            title={
              isRecording ? 'Stop and save recording' : 'Record this session'
            }
          >
            <Circle
              size={12}
              className={cn(isRecording ? 'fill-white text-white' : 'fill-rose-500 text-rose-500')}
              strokeWidth={0}
            />
            {isRecording ? 'Recording' : 'Record'}
            {isRecording && (
              <span className="font-mono text-[11px] tracking-normal normal-case tabular-nums">
                {recordingClock}
              </span>
            )}
          </button>
        )}

        {isSavingRecording && (
          <span className="text-[11px] text-[#A0A0A8]">Saving…</span>
        )}
      </div>

      <p className="text-[10px] text-[#6B7280] leading-[1.45]">
        Voice and video are not saved unless you tap Record.
      </p>

      {recordingNotice && (
        <p
          className={cn(
            'text-[11px] leading-[1.45]',
            recordingNotice === 'Recording saved'
              ? 'text-teal-400'
              : 'text-rose-400'
          )}
        >
          {recordingNotice}
        </p>
      )}
    </div>
  );

  /**
   * Padding-bottom 16:9 box — more reliable than aspect-ratio inside nested
   * flex + overflow on Android Chrome (which collapsed the preview to a sliver).
   */
  const videoPreview = (
    <div className="relative w-full flex-none shrink-0 overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-900">
      <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="absolute inset-0 box-border h-full w-full object-cover scale-x-[-1]"
        />
        {!hasPreview && phase !== 'live' && phase !== 'starting' && (
          <div className="absolute inset-0 flex items-center justify-center text-[#6B7280] text-[11px] sm:text-sm px-4 text-center">
            Camera preview appears when you start
          </div>
        )}
        {phase === 'live' && (
          <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
            <div className="px-2 py-0.5 rounded-lg bg-rose-500/90 text-[10px] font-bold uppercase tracking-wider">
              Live · {secondsLeft}s
            </div>
            {isRecording && (
              <div className="px-2 py-0.5 rounded-lg bg-rose-600 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                Rec {recordingClock}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const statusBlock = (
    <div
      className={cn(
        'rounded-2xl border border-slate-800 bg-slate-900/50 space-y-2 flex-shrink-0',
        embedded ? 'px-3 py-2.5' : 'px-4 py-3'
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
  );

  if (embedded) {
    // Video OUTSIDE the scroll flex — avoids Android collapsing aspect boxes
    // inside flex-1 + min-h-0 + overflow-y-auto parents.
    return (
      <div
        className={cn(
          'flex flex-col flex-1 h-full min-h-0 gap-2 overflow-hidden text-[#F5F5F5]',
          className
        )}
      >
        {videoPreview}
        <canvas ref={canvasRef} className="hidden" />

        <div
          className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide flex flex-col gap-2.5"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {statusBlock}
          <p className="text-[11px] text-[#6B7280] leading-[1.5] flex-shrink-0">
            Voice + video · 3 min limit
          </p>
        </div>

        <div className="flex-shrink-0 pt-1 border-t border-slate-800/60">
          {actions}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-5 text-[#F5F5F5]', className)}>
      {videoPreview}
      <canvas ref={canvasRef} className="hidden" />
      {statusBlock}
      {actions}
      <p className="text-[11px] text-[#6B7280] leading-[1.5] flex-shrink-0">
        Voice + video · 3 min limit ·{' '}
        <code className="text-[#A0A0A8]">{LIVE_MODEL}</code>
      </p>
    </div>
  );
};

export default LiveCoachSessionView;
