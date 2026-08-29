import React from 'react';
import { MoreVertical } from 'lucide-react';
import useStore from '../store/useStore';
import { cn } from '../utils/cn';

interface HeaderProps {
  /** Mobile: open/close AI Coach pane (same control as desktop patient bar). */
  coachOpen?: boolean;
  onToggleCoach?: () => void;
}

/**
 * Header Component (mobile).
 * User identity, connection status, AI Coach, view mode, and side menu.
 * 60 Hz notch filter lives in the side menu to free header space for Coach.
 */
const Header: React.FC<HeaderProps> = ({ coachOpen = false, onToggleCoach }) => {
  const {
    currentUser,
    isConnected,
    connectionStatus,
    viewMode,
    setViewMode,
    setIsAdvancedMenuOpen,
  } = useStore();

  // Priority: Firebase profile displayName → substring before @ in email → "User"
  const displayName =
    currentUser?.displayName?.split(' ')[0] // first name
    ?? currentUser?.email?.split('@')[0] // fallback: email local part
    ?? 'User';

  const statusLabel =
    connectionStatus === 'Connecting'
      ? 'Connecting...'
      : isConnected
        ? 'Connected'
        : 'Disconnected';

  return (
    <header className="flex justify-between items-center gap-2 px-4 py-3 bg-black relative z-50">
      <div className="flex items-center gap-1 min-w-0 flex-1 text-[10px] font-medium text-slate-300 uppercase tracking-tighter">
        <span className="truncate flex-shrink-0 text-slate-200">{displayName}</span>
        <span className="flex-shrink-0 text-slate-600">•</span>
        <span
          className={cn(
            'truncate',
            !isConnected
              ? 'text-rose-400'
              : connectionStatus === 'Connecting'
                ? 'text-amber-400'
                : 'text-emerald-400'
          )}
        >
          {statusLabel}
        </span>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {onToggleCoach && (
          <button
            type="button"
            onClick={onToggleCoach}
            title={coachOpen ? 'Close AI Coach' : 'AI Coach'}
            aria-label={coachOpen ? 'Close AI Coach' : 'Open AI Coach'}
            aria-pressed={coachOpen}
            className={cn(
              'h-7 min-w-7 px-1.5 flex items-center justify-center rounded-full transition-all border flex-shrink-0',
              coachOpen
                ? 'bg-teal-500 text-slate-950 border-teal-400 shadow-[0_0_0_2px_rgba(45,212,191,0.25)]'
                : 'bg-slate-900 text-teal-400 border-teal-500/40 hover:bg-teal-500/15 hover:text-teal-300'
            )}
          >
            <span className="text-[10px] font-bold tracking-wide leading-none">AI</span>
          </button>
        )}

        <div className="flex bg-slate-900 p-0.5 rounded-full border border-slate-700/80">
          <button
            type="button"
            onClick={() => setViewMode('Advanced')}
            className={cn(
              'px-2.5 sm:px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-medium uppercase tracking-tight transition-all',
              viewMode === 'Advanced'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            Advanced
          </button>
          <button
            type="button"
            onClick={() => setViewMode('Normal')}
            className={cn(
              'px-2.5 sm:px-3 py-1.5 rounded-full text-[10px] sm:text-[11px] font-medium uppercase tracking-tight transition-all',
              viewMode === 'Normal'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
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
