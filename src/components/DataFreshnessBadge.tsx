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

const STATUS_LINE: Record<DataFreshness, { dot: string; text: string; label: string }> = {
  LIVE: { dot: 'bg-teal-400', text: 'text-teal-400/80', label: 'Live' },
  STALE: { dot: 'bg-amber-400/80', text: 'text-amber-300/70', label: 'Last data' },
  DEMO: { dot: 'bg-amber-400', text: 'text-amber-400/80', label: 'Demo data' },
  NO_DATA: { dot: 'bg-slate-600', text: 'text-slate-500', label: 'No live data' },
};

/**
 * Quiet dot + text status for panel headers (no chip border, so it doesn't
 * read as a button). Unlike the badge, LIVE is shown too, so the header
 * always says what state the panel is in.
 */
export const FreshnessStatusLine: React.FC<{
  freshness: DataFreshness;
  staleAgeLabel?: string | null;
  className?: string;
}> = ({ freshness, staleAgeLabel, className }) => {
  const s = STATUS_LINE[freshness];
  const label =
    freshness === 'STALE' && staleAgeLabel ? `${s.label} ${staleAgeLabel} ago` : s.label;

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[10px] whitespace-nowrap', s.text, className)}>
      <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
        {freshness === 'LIVE' && (
          <span className={cn('absolute inset-0 rounded-full animate-ping opacity-60', s.dot)} />
        )}
        <span className={cn('relative h-1.5 w-1.5 rounded-full', s.dot)} />
      </span>
      {label}
    </span>
  );
};

export default DataFreshnessBadge;
