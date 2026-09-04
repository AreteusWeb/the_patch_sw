import React from 'react';
import {
  Cable,
  Download,
  Pause,
  Play,
  Settings,
  Sparkles,
  Square,
  Zap,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import { openElectrodeGuide } from '../../lib/electrodeGuide';
import { formatSessionClock, getRecoveryScore } from '../../utils/fitnessMetrics';
import { useFitnessSessionElapsed } from '../../hooks/useFitnessSessionElapsed';
import { exportSessionJson } from '../../utils/exportSessionJson';

interface DesktopPatientBarProps {
  coachOpen: boolean;
  onToggleCoach: () => void;
}

/**
 * DesktopPatientBar
 * Responsive top bar: collapses labels / center status when the window narrows
 * so controls never overlap.
 */
const DesktopPatientBar: React.FC<DesktopPatientBarProps> = ({
  coachOpen,
  onToggleCoach,
}) => {
  const {
    currentUser,
    isConnected,
    connectionStatus,
    batteryLevel,
    historyOffset,
    isLive,
    setIsLive,
    setIsAdvancedMenuOpen,
    notchFilterEnabled,
    setNotchFilterEnabled,
    desktopLayout,
    setDesktopLayout,
    vitals,
    hasRealData,
    fitnessSessionStatus,
    startFitnessSession,
    pauseFitnessSession,
    resumeFitnessSession,
    endFitnessSession,
  } = useStore();

  const displayName =
    currentUser?.displayName ?? currentUser?.email?.split('@')[0] ?? 'Patient';

  const patientId = currentUser?.uid?.slice(0, 8).toUpperCase() ?? '—';
  const isViewingPast = historyOffset > 0;
  const isFitness = desktopLayout === 'fitness';

  const patchLive = isConnected && hasRealData;

  const statusLabel = isViewingPast
    ? 'REVIEWING HISTORY'
    : patchLive
      ? 'CONNECTED'
      : connectionStatus === 'Connecting'
        ? 'WAITING FOR PATCH'
        : 'OFFLINE';

  const statusColor = isViewingPast
    ? 'text-amber-400'
    : patchLive
      ? 'text-emerald-400'
      : connectionStatus === 'Connecting'
        ? 'text-amber-400'
        : 'text-rose-400';

  const patchLabel = patchLive ? 'Patch Connected' : 'Patch Disconnected';
  const patchColor = patchLive ? 'text-emerald-400' : 'text-rose-400';

  const sessionElapsed = useFitnessSessionElapsed();
  const sessionActive =
    fitnessSessionStatus === 'recording' || fitnessSessionStatus === 'paused';

  const sessionStatusLabel =
    fitnessSessionStatus === 'recording' ? 'Recording'
      : fitnessSessionStatus === 'paused' ? 'Paused'
        : fitnessSessionStatus === 'ended' ? 'Ended'
          : 'Idle';

  const recovery = getRecoveryScore(vitals, patchLive);

  const handleFitnessPrimary = () => {
    if (fitnessSessionStatus === 'idle' || fitnessSessionStatus === 'ended') {
      startFitnessSession();
      return;
    }
    endFitnessSession();
  };

  const handlePauseResume = () => {
    if (isFitness && sessionActive) {
      if (fitnessSessionStatus === 'recording') pauseFitnessSession();
      else resumeFitnessSession();
      return;
    }
    setIsLive(!isLive);
  };

  const actionBtnClass =
    'flex items-center justify-center gap-1.5 h-9 xl:h-10 px-2.5 xl:px-3.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[10px] xl:text-[11px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-slate-700 transition-colors';

  const iconBtnClass =
    'h-9 w-9 xl:h-10 xl:w-10 flex items-center justify-center rounded-lg border transition-all shrink-0';

  const pauseLabel = isFitness
    ? (fitnessSessionStatus === 'recording' ? 'Pause' : 'Resume')
    : (isLive ? 'Pause Recording' : 'Resume');

  const exportLabel = isFitness ? 'Export' : 'Export Data';

  return (
    <header className="relative flex-shrink-0 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md z-20">
      <div className="px-3 xl:px-6 py-2.5 xl:py-3 flex items-center justify-between gap-2 xl:gap-4 min-h-[52px] xl:min-h-[56px]">
        {/* Left: identity + mode toggle */}
        <div className="flex items-center gap-2 xl:gap-5 min-w-0 z-10">
          <div className="flex flex-col gap-0.5 min-w-0">
            <div className="flex items-center gap-2 xl:gap-3 text-sm flex-wrap">
              <span className="font-semibold text-white truncate max-w-[9rem] sm:max-w-[14rem] xl:max-w-none">
                {isFitness ? `Athlete: ${displayName}` : `Patient: ${displayName}`}
              </span>
              {!isFitness && (
                <span className="hidden 2xl:inline text-slate-400 tabular-nums text-sm">
                  <span className="text-slate-600 mr-2">|</span>
                  ID: {patientId}
                </span>
              )}
            </div>

            {/* Compact status — shown when center status is hidden */}
            <div className="2xl:hidden flex items-center gap-1.5 min-w-0">
              <span className={cn('text-[10px] font-bold uppercase tracking-wider truncate', statusColor)}>
                {statusLabel}
              </span>
              <span className="text-slate-700">·</span>
              <span className={cn('text-[10px] truncate', patchColor)}>{patchLabel}</span>
            </div>

            <div className="hidden xl:block min-h-[18px] text-[11px] text-slate-500">
              {isFitness ? (
                <span className="truncate">
                  Session:{' '}
                  <span className={cn(
                    'font-semibold',
                    fitnessSessionStatus === 'recording' && 'text-teal-400',
                    fitnessSessionStatus === 'paused' && 'text-amber-400',
                    fitnessSessionStatus === 'ended' && 'text-slate-300',
                  )}>
                    {sessionStatusLabel}
                  </span>
                  {' • '}
                  <span className="text-white font-semibold tabular-nums">
                    {formatSessionClock(sessionElapsed)}
                  </span>
                  {' • '}
                  Recovery:{' '}
                  <span className="text-teal-400 font-semibold tabular-nums">
                    {patchLive ? `${recovery.score}/100` : '--'}
                  </span>
                </span>
              ) : (
                <span>Monitoring: Day — of — • Started —</span>
              )}
            </div>
          </div>

          <div
            className="flex-shrink-0 flex bg-slate-900/60 backdrop-blur-md p-0.5 xl:p-1 rounded-full border border-slate-800/50 gap-0.5 xl:gap-1"
            role="group"
            aria-label="Desktop layout mode"
          >
            <button
              type="button"
              onClick={() => setDesktopLayout('normal')}
              className={cn(
                'px-2.5 xl:px-5 py-1.5 xl:py-2 rounded-full text-[10px] xl:text-xs font-semibold uppercase tracking-[0.12em] transition-all',
                !isFitness
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              Normal
            </button>
            <button
              type="button"
              onClick={() => setDesktopLayout('fitness')}
              className={cn(
                'px-2.5 xl:px-5 py-1.5 xl:py-2 rounded-full text-[10px] xl:text-xs font-semibold uppercase tracking-[0.12em] transition-all',
                isFitness
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              Fitness
            </button>
          </div>
        </div>

        {/* Right: actions — labels collapse to icons when narrow */}
        <div className="flex items-center gap-1 xl:gap-2 flex-shrink-0 z-10">
          {isFitness && (
            <button
              type="button"
              onClick={handleFitnessPrimary}
              className={cn(
                actionBtnClass,
                sessionActive && 'border-rose-500/40 text-rose-300 hover:text-rose-200'
              )}
              title={
                sessionActive
                  ? 'End training session'
                  : fitnessSessionStatus === 'ended'
                    ? 'Start a new training session'
                    : 'Start training session'
              }
            >
              {sessionActive ? <Square size={14} /> : <Play size={14} />}
              <span className="hidden xl:inline">
                {sessionActive
                  ? 'End Session'
                  : fitnessSessionStatus === 'ended'
                    ? 'New Session'
                    : 'Start Session'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={handlePauseResume}
            disabled={isFitness && (fitnessSessionStatus === 'idle' || fitnessSessionStatus === 'ended')}
            className={cn(
              actionBtnClass,
              isFitness && (fitnessSessionStatus === 'idle' || fitnessSessionStatus === 'ended')
                && 'opacity-40 cursor-not-allowed hover:text-slate-300 hover:border-slate-800'
            )}
            title={pauseLabel}
          >
            {isFitness
              ? (fitnessSessionStatus === 'recording' ? <Pause size={14} /> : <Play size={14} />)
              : (isLive ? <Pause size={14} /> : <Play size={14} />)}
            <span className="hidden xl:inline">{pauseLabel}</span>
          </button>

          <button
            type="button"
            onClick={() => exportSessionJson(isFitness ? 'fitness' : 'clinical')}
            className={actionBtnClass}
            title={exportLabel}
          >
            <Download size={14} />
            <span className="hidden xl:inline">{exportLabel}</span>
          </button>

          <button
            type="button"
            onClick={onToggleCoach}
            className={cn(
              actionBtnClass,
              coachOpen && 'border-teal-500/40 text-teal-300 hover:text-teal-200'
            )}
            title="AI Coach"
          >
            <Sparkles size={14} />
            <span className="hidden lg:inline">AI Coach</span>
          </button>

          <button
            type="button"
            onClick={openElectrodeGuide}
            className={actionBtnClass}
            title="Electrode Guide"
          >
            <Cable size={14} />
            <span className="hidden lg:inline">Electrode Guide</span>
          </button>

          <button
            onClick={() => setNotchFilterEnabled(!notchFilterEnabled)}
            title={
              notchFilterEnabled
                ? '60 Hz notch filter ON — removes electrical hum from the ECG'
                : '60 Hz notch filter OFF — click to cut electrical hum from the ECG'
            }
            className={cn(
              iconBtnClass,
              notchFilterEnabled
                ? 'bg-teal-500/20 border-teal-500/40 text-teal-400'
                : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-white'
            )}
          >
            <Zap size={16} />
          </button>

          <button
            onClick={() => setIsAdvancedMenuOpen(true)}
            className={cn(
              iconBtnClass,
              'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-700'
            )}
            title="Settings & menu"
          >
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Center status — only when there is real room (avoids overlap) */}
      <div className="hidden 2xl:flex absolute inset-0 items-center justify-center pointer-events-none z-0 px-4">
        <div className="flex flex-col items-center text-center gap-0.5">
          <span
            className={cn(
              'text-sm font-bold uppercase tracking-[0.18em] leading-tight',
              statusColor
            )}
          >
            Status: {statusLabel}
          </span>
          <span className={cn('text-[11px] font-medium tracking-wide leading-tight', patchColor)}>
            {patchLabel}
            {patchLive && batteryLevel != null && (
              <span className="text-slate-500 font-normal"> • {batteryLevel}% Battery</span>
            )}
          </span>
          <span className="text-[10px] text-slate-500 mt-0.5">
            AI Confidence: —
          </span>
        </div>
      </div>
    </header>
  );
};

export default DesktopPatientBar;
