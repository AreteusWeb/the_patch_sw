import React from 'react';
import {
  Download,
  Pause,
  Play,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import { formatDuration, getRecoveryScore } from '../../utils/fitnessMetrics';

/**
 * DesktopPatientBar
 * Barra superior: identidad + toggle fijo junto al nombre, acciones a la derecha.
 */
const DesktopPatientBar: React.FC = () => {
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
  } = useStore();

  const displayName =
    currentUser?.displayName ?? currentUser?.email?.split('@')[0] ?? 'Patient';

  const patientId = currentUser?.uid?.slice(0, 8).toUpperCase() ?? '—';
  const isViewingPast = historyOffset > 0;
  const isFitness = desktopLayout === 'fitness';

  /** True only when the physical patch is streaming live samples. */
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

  const aiConfidence = patchLive ? 94 : null;

  const patchLabel = patchLive ? 'Patch Connected' : 'Patch Disconnected';
  const patchColor = patchLive ? 'text-emerald-400' : 'text-rose-400';

  const sessionStart = React.useMemo(() => {
    const d = new Date();
    d.setHours(9, 15, 0, 0);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!patchLive) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start + historyOffset * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [patchLive, historyOffset]);

  const recovery = getRecoveryScore(vitals, patchLive);

  const actionBtnClass =
    'flex items-center gap-1.5 h-10 px-3.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[11px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-slate-700 transition-colors';

  const iconBtnClass =
    'h-10 w-10 flex items-center justify-center rounded-lg border transition-all';

  return (
    <header className="relative flex-shrink-0 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
      <div className="px-6 py-3 flex items-start justify-between gap-6 min-h-[56px]">
        {/* Left: identity + toggle */}
        <div className="flex items-start gap-5 min-w-0 z-10">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-3 text-sm flex-wrap">
              <span className="font-semibold text-white truncate">
                {isFitness ? `Athlete: ${displayName}` : `Patient: ${displayName}`}
              </span>
              {!isFitness && (
                <>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-400 tabular-nums">ID: {patientId}</span>
                </>
              )}
            </div>

            <div className="min-h-[18px] text-[11px] text-slate-500">
              {isFitness ? (
                <span>
                  Session: Training Day • Duration: {formatDuration(elapsed)}
                  {' • '}
                  Recovery:{' '}
                  <span className="text-teal-400 font-semibold tabular-nums">
                    {patchLive ? `${recovery.score}/100` : '--'}
                  </span>
                  {patchLive && (
                    <span className="text-teal-400/80"> ({recovery.label})</span>
                  )}
                </span>
              ) : (
                <span>Monitoring: Day 1 of 7 • Started {sessionStart}</span>
              )}
            </div>
          </div>

          <div
            className="flex-shrink-0 flex bg-slate-900/60 backdrop-blur-md p-1 rounded-full border border-slate-800/50 gap-1"
            role="group"
            aria-label="Desktop layout mode"
          >
            <button
              type="button"
              onClick={() => setDesktopLayout('normal')}
              className={cn(
                'px-5 py-2 rounded-full text-xs font-semibold uppercase tracking-[0.12em] transition-all',
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
                'px-5 py-2 rounded-full text-xs font-semibold uppercase tracking-[0.12em] transition-all',
                isFitness
                  ? 'bg-slate-700 text-white shadow-sm'
                  : 'text-slate-500 hover:text-slate-300'
              )}
            >
              Fitness
            </button>
          </div>
        </div>

        {/* Right: actions — same height as Normal/Fitness toggle */}
        <div className="flex items-center gap-2 flex-shrink-0 z-10 ml-auto self-center">
          {isFitness && (
            <button
              className={actionBtnClass}
              title="Start new session (coming soon)"
            >
              <Play size={14} />
              Start Session
            </button>
          )}

          <button
            onClick={() => setIsLive(!isLive)}
            className={actionBtnClass}
          >
            {isLive ? <Pause size={14} /> : <Play size={14} />}
            {isFitness
              ? (isLive ? 'Pause' : 'Resume')
              : (isLive ? 'Pause Recording' : 'Resume')}
          </button>

          <button
            className={actionBtnClass}
            title="Export (coming soon)"
          >
            <Download size={14} />
            {isFitness ? 'Export' : 'Export Data'}
          </button>

          {isFitness && (
            <button
              className={actionBtnClass}
              title="AI Coach Insights"
            >
              <Sparkles size={14} />
              AI Coach
            </button>
          )}

          <button
            onClick={() => setNotchFilterEnabled(!notchFilterEnabled)}
            title={notchFilterEnabled ? '60Hz notch filter: ON' : '60Hz notch filter: OFF'}
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

      {/* Center: status — true vertical + horizontal center of the bar */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 px-4">
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
          {aiConfidence != null && (
            <span className="text-[10px] text-slate-500 mt-0.5">
              AI Confidence: {aiConfidence}%
            </span>
          )}
        </div>
      </div>
    </header>
  );
};

export default DesktopPatientBar;
