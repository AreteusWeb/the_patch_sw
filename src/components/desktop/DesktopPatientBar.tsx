import React from 'react';
import {
  AlertTriangle,
  Download,
  MoreVertical,
  Pause,
  Play,
  Settings,
  User,
  Zap,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';

/**
 * DesktopPatientBar
 * Barra superior de ancho completo: paciente, estado de monitoreo y acciones.
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
  } = useStore();

  const displayName =
    currentUser?.displayName ?? currentUser?.email?.split('@')[0] ?? 'Patient';

  const patientId = currentUser?.uid?.slice(0, 8).toUpperCase() ?? '—';
  const isViewingPast = historyOffset > 0;
  const alertCount = alerts.length;

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

  return (
    <header className="flex-shrink-0 border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md">
      <div className="px-6 py-3 flex items-center justify-between gap-6">
        {/* Patient identity */}
        <div className="flex flex-col gap-1 min-w-0">
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
        </div>

        {/* Status + connection */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
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
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setIsLive(!isLive)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
          >
            {isLive ? <Pause size={12} /> : <Play size={12} />}
            {isLive ? 'Pause Recording' : 'Resume'}
          </button>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[10px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-slate-700 transition-colors"
            title="Export data (coming soon)"
          >
            <Download size={12} />
            Export Data
          </button>

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
