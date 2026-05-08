import React from 'react';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '../utils/cn';
import useStore from '../store/useStore';

const EventBanner: React.FC = () => {
  const activeEventBanner = useStore(s => s.activeEventBanner);
  const dismissBanner     = useStore(s => s.dismissBanner);
  const jumpToEvent       = useStore(s => s.jumpToEvent);
  const historyOffset     = useStore(s => s.historyOffset);

  // Si no hay evento activo, no mostrar nada
  if (!activeEventBanner) return null;

  const isHigh = activeEventBanner.severity === 'high';

  const handleClick = () => {
    // Si ya estamos viendo ese evento, volver a live
    if (historyOffset > 0) {
      useStore.getState().setHistoryOffset(0);
    } else {
      jumpToEvent(activeEventBanner);
    }
  };

  return (
    <div className={cn(
      "flex items-center justify-between px-5 py-1.5 border rounded-full w-fit gap-4 mx-auto mt-2 mb-1 cursor-pointer transition-all hover:brightness-125",
      isHigh
        ? "bg-rose-950/20 border-rose-900/30"
        : "bg-amber-950/20 border-amber-900/30"
    )}
      onClick={handleClick}
    >
      {/* Dot parpadeante */}
      <span className={cn(
        "w-1.5 h-1.5 rounded-full animate-pulse flex-shrink-0",
        isHigh ? "bg-rose-500" : "bg-amber-400"
      )} />

      <span className={cn(
        "text-[8px] font-bold tracking-[0.1em] uppercase whitespace-nowrap",
        isHigh ? "text-rose-500/90" : "text-amber-400/90"
      )}>
        {activeEventBanner.label}
        {historyOffset === 0
          ? " — tap to review"
          : " — viewing past"}
      </span>

      {/* X para dismiss */}
      <button
        onClick={(e) => { e.stopPropagation(); dismissBanner(); }}
        className="text-slate-600 hover:text-slate-400 transition-colors"
      >
        <X size={10} />
      </button>
    </div>
  );
};

export default EventBanner;
