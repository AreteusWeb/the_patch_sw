import React from 'react';
import { Unplug } from 'lucide-react';
import { cn } from '../utils/cn';
import type { DataFreshness } from '../types';

interface DataFreshnessBadgeProps {
  freshness: DataFreshness;
  staleAgeLabel?: string | null;
  className?: string;
  /** Compact single-line for tight vital rows. */
  compact?: boolean;
}

/**
 * Status chip next to vital values / waveform panels.
 * LIVE renders nothing (active UI is the cue).
 */
const DataFreshnessBadge: React.FC<DataFreshnessBadgeProps> = ({
  freshness,
  staleAgeLabel,
  className,
  compact = false,
}) => {
  if (freshness === 'LIVE') return null;

  if (freshness === 'DEMO') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-md border border-amber-500/35 bg-amber-500/10 font-bold uppercase tracking-wider text-amber-400',
          compact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]',
          className
        )}
      >
        DEMO
      </span>
    );
  }

  if (freshness === 'STALE') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-slate-600/50 bg-slate-800/60 text-slate-400',
          compact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]',
          className
        )}
      >
        Last data{staleAgeLabel ? `: ${staleAgeLabel}` : ''}
      </span>
    );
  }

  // NO_DATA
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-slate-700/60 bg-slate-900/70 text-slate-500',
        compact ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-0.5 text-[9px]',
        className
      )}
    >
      <Unplug size={compact ? 9 : 10} className="opacity-80" />
      No Data
    </span>
  );
};

export default DataFreshnessBadge;
