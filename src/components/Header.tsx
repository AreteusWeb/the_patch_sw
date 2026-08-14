import React from 'react';
import { MoreVertical, Zap } from 'lucide-react';
import useStore from '../store/useStore';
import { cn } from '../utils/cn';

/**
 * Header Component.
 * Displays user identity, device connection status, the 60Hz notch filter
 * toggle, view mode selectors, and handles opening the advanced settings
 * menu drawer.
 */
const Header: React.FC = () => {
  const {
    currentUser,
    isConnected,
    connectionStatus,
    viewMode,
    setViewMode,
    setIsAdvancedMenuOpen,
    notchFilterEnabled,
    setNotchFilterEnabled,
  } = useStore();

  // Priority: Firebase profile displayName → substring before @ in email → "User"
  const displayName =
    currentUser?.displayName?.split(' ')[0]   // first name
    ?? currentUser?.email?.split('@')[0]       // fallback: email local part
    ?? 'User';

  const statusLabel = connectionStatus === 'Connecting'
    ? 'Connecting...'
    : isConnected
      ? 'Connected'
      : 'Disconnected';

  return (
    <header className="flex justify-between items-center gap-2 px-4 py-3 bg-black relative z-50">
      <div className="flex items-center gap-1 min-w-0 flex-1 text-[10px] font-medium text-slate-300 uppercase tracking-tighter">
        <span className="truncate flex-shrink-0 text-slate-200">{displayName}</span>
        <span className="flex-shrink-0 text-slate-600">•</span>
        <span className={cn(
          'truncate',
          !isConnected
            ? 'text-rose-400'
            : connectionStatus === 'Connecting'
              ? 'text-amber-400'
              : 'text-emerald-400'
        )}>
          {statusLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {/* 60Hz notch filter — removes power-line hum from the ECG */}
        <button
          type="button"
          onClick={() => setNotchFilterEnabled(!notchFilterEnabled)}
          title={
            notchFilterEnabled
              ? '60 Hz notch filter ON — removes electrical hum from the ECG (not the 250 Hz sample rate)'
              : '60 Hz notch filter OFF — click to cut electrical hum from the ECG (not the 250 Hz sample rate)'
          }
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded-full transition-all border flex-shrink-0',
            notchFilterEnabled
              ? 'bg-teal-500 text-white border-teal-400'
              : 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white'
          )}
        >
          <Zap size={12} />
        </button>

        <div className="flex bg-slate-900 p-0.5 rounded-full border border-slate-700/80">
          <button
            type="button"
            onClick={() => setViewMode('Advanced')}
            className={cn(
              'px-2.5 sm:px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-medium uppercase tracking-tight transition-all',
              viewMode === 'Advanced' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Advanced
          </button>
          <button
            type="button"
            onClick={() => setViewMode('Normal')}
            className={cn(
              'px-2.5 sm:px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-medium uppercase tracking-tight transition-all',
              viewMode === 'Normal' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Normal
          </button>
        </div>
        <button
          type="button"
          onClick={() => setIsAdvancedMenuOpen(true)}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white transition-all border border-slate-700"
          aria-label="Open menu"
        >
          <MoreVertical size={14} />
        </button>
      </div>
    </header>
  );
};

export default Header;
