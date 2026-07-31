import React from 'react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';

const MAX_HISTORY_SECONDS = 3600;

/**
 * Mobile timeline — slider + Live only.
 * Dragging left shows past waveforms/vitals; Live jumps back to now.
 */
const MobileLiveBar: React.FC = () => {
  const historyOffset = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);
  const isLive = historyOffset === 0;

  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const displayTime = React.useMemo(() => {
    const target = new Date(isLive ? now : Date.now() - historyOffset * 1000);
    return target.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [isLive, now, historyOffset]);

  return (
    <div className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950/80 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <input
            type="range"
            min={-MAX_HISTORY_SECONDS}
            max={0}
            step={1}
            value={-historyOffset}
            onChange={(e) => setHistoryOffset(-Number(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
          />
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>{isLive ? 'Timeline' : 'Viewing past'}</span>
            <span className={cn('tabular-nums', isLive ? 'text-teal-400' : 'text-slate-300')}>
              {displayTime}
              {isLive && (
                <span className="ml-1.5 text-[8px] font-bold uppercase tracking-widest animate-pulse">
                  Live
                </span>
              )}
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setHistoryOffset(0)}
          className={cn(
            'px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all flex-shrink-0',
            isLive
              ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
              : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
          )}
        >
          Live
        </button>
      </div>
    </div>
  );
};

export default MobileLiveBar;
