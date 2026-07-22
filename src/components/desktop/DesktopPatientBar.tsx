import React from 'react';
import {
  AlertTriangle,
  Download,
  Dumbbell,
  MoreVertical,
  Pause,
  Play,
  Settings,
  Sparkles,
  Stethoscope,
  User,
  Zap,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import { formatDuration, getRecoveryScore } from '../../utils/fitnessMetrics';

/**
 * DesktopPatientBar
 * Barra superior de ancho completo: paciente/atleta, estado y toggle Normal ↔ Fitness.
 */
const DesktopPatientBar: React.FC = () => {
  const {
    currentUser,
    isConnected,
    connectionStatus,
    batteryLevel,
    historyOffset,
    alerts,
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
  const alertCount = alerts.length;
  const isFitness = desktopLayout === 'fitness';

  const statusLabel = isViewingPast
    ? 'REVIEWING HISTORY'
    : isConnected
      ? 'STABLE'
      : 'DISCONNECTED';

  const statusColor = isViewingPast
    ? 'text-amber-400'
    : isConnected
      ? 'text-emerald-400'
      : 'text-rose-400';

  const aiConfidence = isConnected ? 94 : 0;

  const sessionStart = React.useMemo(() => {
    const d = new Date();
    d.setHours(9, 15, 0, 0);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }, []);

  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!isConnected) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start + historyOffset * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isConnected, historyOffset]);

  const recovery = getRecoveryScore(vitals, hasRealData && isConnected);

  return (
    <header className="flex-shrink-0 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
      <div className="px-6 py-3 flex items-center justify-between gap-4">
        {/* Identity — clinical vs athlete framing */}
        <div className="flex flex-col gap-1 min-w-0">
          {isFitness ? (
            <>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-white truncate">
                  Athlete: {displayName}
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">
                  Session: Training Day • Duration: {formatDuration(elapsed)}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-slate-500">
                <span>
                  Overall Recovery Score:{' '}
                  <span className="text-emerald-400 font-semibold tabular-nums">
                    {hasRealData && isConnected ? `${recovery.score}/100` : '--'}
                  </span>
                  {hasRealData && isConnected && (
                    <span className="text-emerald-400/80"> ({recovery.label})</span>
                  )}
                </span>
                <span className="text-slate-700">•</span>
                <span className={cn(
                  'flex items-center gap-1',
                  isViewingPast ? 'text-amber-400' : 'text-emerald-400'
                )}>
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    isViewingPast ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
                  )} />
                  {isViewingPast ? 'Historical' : 'Live'}
                </span>
                <span>•</span>
                <span className={isConnected ? 'text-emerald-400' : 'text-rose-400'}>
                  Patch {isConnected ? 'Connected' : connectionStatus === 'Connecting' ? 'Connecting…' : 'Disconnected'}
                </span>
                {batteryLevel != null && (
                  <>
                    <span>•</span>
                    <span>{batteryLevel}% Battery</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-white truncate">
                  Patient: {displayName}
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400 tabular-nums">ID: {patientId}</span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Age: —</span>
              </div>
              <div className="flex items-center gap-4 text-[11px]">
                <span className="text-slate-500">
                  Monitoring: Day 1 of 7 • Started {sessionStart}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Layout toggle + clinical status (clinical mode) */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0">
          <div
            className="flex items-center rounded-lg border border-slate-800 bg-slate-900/80 p-0.5"
            role="group"
            aria-label="Desktop layout mode"
          >
            <button
              type="button"
              onClick={() => setDesktopLayout('normal')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all',
                !isFitness
                  ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              )}
            >
              <Stethoscope size={12} />
              Normal
            </button>
            <button
              type="button"
              onClick={() => setDesktopLayout('fitness')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all',
                isFitness
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : 'text-slate-500 hover:text-slate-300 border border-transparent'
              )}
            >
              <Dumbbell size={12} />
              Fitness
            </button>
          </div>

          {!isFitness && (
            <>
              <div className="flex items-center gap-3">
                <span className={cn('text-xs font-bold uppercase tracking-widest', statusColor)}>
                  Status: {statusLabel}
                </span>
                {isConnected && (
                  <span className="text-[10px] text-slate-500">
                    AI Confidence: {aiConfidence}%
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-slate-500">
                <span className={cn(
                  'flex items-center gap-1',
                  isViewingPast ? 'text-amber-400' : 'text-emerald-400'
                )}>
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full',
                    isViewingPast ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'
                  )} />
                  {isViewingPast ? 'Historical' : 'Live'}
                </span>
                <span>•</span>
                <span className={isConnected ? 'text-emerald-400' : 'text-rose-400'}>
                  Patch {connectionStatus === 'Connecting' ? 'Connecting…' : isConnected ? 'Connected' : 'Disconnected'}
                </span>
                {batteryLevel != null && (
                  <>
                    <span>•</span>
                    <span>{batteryLevel}% Battery</span>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {isFitness && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[10px] font-bold uppercase tracking-wider text-amber-300 hover:bg-amber-500/20 transition-colors"
              title="Start new session (coming soon)"
            >
              <Play size={12} />
              Start Session
            </button>
          )}

          <button
            onClick={() => setIsLive(!isLive)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
          >
            {isLive ? <Pause size={12} /> : <Play size={12} />}
            {isFitness
              ? (isLive ? 'Pause' : 'Resume')
              : (isLive ? 'Pause Recording' : 'Resume')}
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
            title="Export (coming soon)"
          >
            <Download size={12} />
            {isFitness ? 'Export Workout' : 'Export Data'}
          </button>

          {isFitness && (
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
              title="AI Coach Insights"
            >
              <Sparkles size={12} />
              AI Coach
            </button>
          )}

          {!isFitness && (
            <button
              className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
            >
              <AlertTriangle size={12} />
              Alerts
              {alertCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
                  {alertCount > 99 ? '99+' : alertCount}
                </span>
              )}
            </button>
          )}

          <button
            onClick={() => setNotchFilterEnabled(!notchFilterEnabled)}
            title={notchFilterEnabled ? '60Hz notch filter: ON' : '60Hz notch filter: OFF'}
            className={cn(
              'w-8 h-8 flex items-center justify-center rounded-lg border transition-all',
              notchFilterEnabled
                ? 'bg-teal-500/20 border-teal-500/40 text-teal-400'
                : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-white'
            )}
          >
            <Zap size={14} />
          </button>

          <button
            onClick={() => setIsAdvancedMenuOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white transition-colors"
            title="Settings"
          >
            <Settings size={14} />
          </button>

          <button
            onClick={() => setIsAdvancedMenuOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white transition-colors"
            title="User menu"
          >
            <User size={14} />
          </button>

          <button
            onClick={() => setIsAdvancedMenuOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white transition-colors lg:hidden"
          >
            <MoreVertical size={14} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default DesktopPatientBar;
