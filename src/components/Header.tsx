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
    isAdvancedMenuOpen,
    setIsAdvancedMenuOpen,
    notchFilterEnabled,
    setNotchFilterEnabled,
  } = useStore();

  // Priority: Firebase profile displayName → substring before @ in email → "User"
  const displayName =
    currentUser?.displayName?.split(' ')[0]   // first name
    ?? currentUser?.email?.split('@')[0]       // fallback: email local part
    ?? 'User';

  return (
    <header className="flex justify-between items-center px-4 py-3 bg-transparent whitespace-nowrap relative z-50">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1 text-[10px] font-light text-slate-400 uppercase tracking-tighter">
          <span>{displayName} • </span>
          <span className={cn(
            !isConnected
              ? 'text-rose-500'
              : connectionStatus === 'Connecting'
                ? 'text-yellow-500'
                : 'text-emerald-500'
          )}>
            Device {connectionStatus === 'Connecting' ? 'Connecting...' : (isConnected ? 'Connected' : 'Disconnected')}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Filtro Notch 60Hz — quita el zumbido de línea eléctrica del ECG */}
        <button
          onClick={() => setNotchFilterEnabled(!notchFilterEnabled)}
          title={notchFilterEnabled ? '60Hz notch filter: ON' : '60Hz notch filter: OFF'}
          className={cn(
            "w-6 h-6 flex items-center justify-center rounded-full transition-all shadow-lg border",
            notchFilterEnabled
              ? "bg-teal-500 text-white border-teal-400 shadow-teal-500/20"
              : "bg-slate-800/60 text-slate-400 border-white/5 hover:bg-slate-700 hover:text-white"
          )}
        >
          <Zap size={12} />
        </button>

        <div className="flex bg-slate-900/60 backdrop-blur-md p-0.5 rounded-full border border-slate-800/50">
          <button
            onClick={() => setViewMode('Advanced')}
            className={cn(
              'px-3 py-1.5 rounded-full text-[11px] font-medium uppercase tracking-tight transition-all',
              viewMode === 'Advanced' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
            )}
          >
            Advanced
          </button>
          <button
            onClick={() => setViewMode('Normal')}
            className={cn(
              'px-3 py-1.5 rounded-full text-[11px] font-medium uppercase tracking-tight transition-all',
              viewMode === 'Normal' ? 'bg-slate-700 text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'
            )}
          >
            Normal
          </button>
        </div>
        <button
          onClick={() => setIsAdvancedMenuOpen(true)}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-slate-800/60 text-slate-400 hover:bg-slate-700 hover:text-white transition-all shadow-lg border border-white/5"
        >
          <MoreVertical size={14} />
        </button>
      </div>
    </header>
  );
};

export default Header;
