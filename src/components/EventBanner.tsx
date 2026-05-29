import React from 'react';
import { X } from 'lucide-react';
import { cn } from '../utils/cn';
import useStore from '../store/useStore';

/**
 * EventBanner Component.
 * Displays a top banner alerting the user of abnormal physiological events in real-time.
 * Clicking the banner allows jumping to the historical event occurrence.
 */
const EventBanner: React.FC = () => {
  const activeEventBanner = useStore(s => s.activeEventBanner);
  const dismissBanner = useStore(s => s.dismissBanner);
  const jumpToEvent = useStore(s => s.jumpToEvent);
  const historyOffset = useStore(s => s.historyOffset);

  if (!activeEventBanner) return null;

  const isHigh = activeEventBanner.severity === 'high';

  const handleClick = () => {
    if (historyOffset > 0) {
      useStore.getState().setHistoryOffset(0);
    } else {
      jumpToEvent(activeEventBanner);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1 border rounded-full cursor-pointer transition-all hover:brightness-125 mx-auto mt-1.5 mb-0.5",
        isHigh
          ? "bg-rose-950/20 border-rose-900/30"
          : "bg-amber-950/20 border-amber-900/30"
      )}
    >
      {/* blinking dot */}
      <span className={cn(
        "w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0",
        isHigh ? "bg-rose-500" : "bg-amber-400"
      )} />

      {/* label */}
      <span className={cn(
        "text-[9px] font-bold tracking-[0.08em] uppercase whitespace-nowrap",
        isHigh ? "text-rose-400" : "text-amber-400"
      )}>
        {activeEventBanner.label}
        {historyOffset > 0 && <span className="opacity-60"> · viewing</span>}
      </span>

      {/* X */}
      <button
        onClick={(e) => { e.stopPropagation(); dismissBanner(); }}
        className="text-slate-600 hover:text-slate-400 transition-colors ml-0.5"
      >
        <X size={9} />
      </button>
    </div>
  );
};

export default EventBanner;
