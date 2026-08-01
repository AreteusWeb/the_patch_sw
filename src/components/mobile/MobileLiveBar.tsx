import React from 'react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';

interface MobileLiveBarProps {
  /** Seconds of history actually buffered — slider only spans this range. */
  bufferedSeconds: number;
}

/**
 * Mobile timeline — slider + Live only.
 * Range matches real buffered history so dragging always lands on real data.
 */
const MobileLiveBar: React.FC<MobileLiveBarProps> = ({ bufferedSeconds }) => {
  const historyOffset = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);

  const maxOffset = Math.max(1, bufferedSeconds);
  const clampedOffset = Math.min(historyOffset, maxOffset);
  const isLive = clampedOffset === 0;
  const canScrub = bufferedSeconds > 0;

  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  React.useEffect(() => {
    if (historyOffset > maxOffset) {
      setHistoryOffset(maxOffset);
    }
  }, [historyOffset, maxOffset, setHistoryOffset]);

  const displayTime = React.useMemo(() => {
    const target = new Date(isLive ? now : Date.now() - clampedOffset * 1000);
    return target.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }, [isLive, now, clampedOffset]);

  const agoLabel = clampedOffset >= 60
    ? `${Math.floor(clampedOffset / 60)}m ${clampedOffset % 60}s ago`
    : `${clampedOffset}s ago`;

  return (
    <div className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950/80 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <input
            type="range"
            min={-maxOffset}
            max={0}
            step={1}
            disabled={!canScrub}
            value={-clampedOffset}
            onChange={(e) => setHistoryOffset(-Number(e.target.value))}
            className={cn(
              'w-full h-1.5 bg-slate-800 rounded-lg appearance-none accent-teal-500',
              canScrub ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
            )}
          />
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>
              {!canScrub
                ? 'Waiting for data…'
                : isLive
                  ? `Timeline · ${bufferedSeconds}s buffered`
                  : agoLabel}
            </span>
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
