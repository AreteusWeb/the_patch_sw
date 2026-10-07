import React from 'react';
import { cn } from '../../utils/cn';
import {
  buildTrendBuckets,
  formatTrendSpan,
  SESSION_TREND_BARS,
  SESSION_TREND_WINDOW_SEC,
  type TrendBuckets,
} from '../../lib/vitalsTrend';

interface VitalTrendBarsProps {
  /** null = not enough history yet (or no sensor) → empty state. */
  trend: TrendBuckets | null;
  /** Minimum y-axis span so small jitter doesn't fill the full height. */
  minRange: number;
  color: string;
  muted?: boolean;
  emptyLabel: string;
}

/**
 * Mini bar chart of averaged vitals over time. The empty state is a dashed
 * baseline + text, deliberately unlike bars, so "no history" never reads as
 * "flat signal".
 */
const VitalTrendBars: React.FC<VitalTrendBarsProps> = ({
  trend,
  minRange,
  color,
  muted = false,
  emptyLabel,
}) => {
  if (!trend) {
    return (
      <div className="h-6 flex-1 min-w-0 relative flex items-end">
        <div className="absolute inset-x-0 bottom-0 border-b border-dashed border-slate-800" />
        <span className="relative pb-1 text-[10px] text-slate-600 italic truncate">
          {emptyLabel}
        </span>
      </div>
    );
  }

  const range = Math.max(trend.max - trend.min, minRange);
  const lo = (trend.min + trend.max) / 2 - range / 2;

  return (
    <div className={cn('h-6 flex-1 min-w-0 flex items-end gap-px', muted && 'opacity-45')}>
      {trend.buckets.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm opacity-80"
          style={
            v == null
              ? undefined
              : {
                  height: `${15 + ((v - lo) / range) * 85}%`,
                  backgroundColor: muted ? '#64748b' : color,
                }
          }
        />
      ))}
    </div>
  );
};

/** Right-sidebar "Session Trends" row: title, value range + span, chart. */
export const SessionTrendRow: React.FC<{
  label: string;
  values: (number | null)[];
  unit: string;
  minRange: number;
  color: string;
  emptyLabel: string;
}> = ({ label, values, unit, minRange, color, emptyLabel }) => {
  const trend = React.useMemo(
    () => buildTrendBuckets(values, SESSION_TREND_WINDOW_SEC, SESSION_TREND_BARS),
    [values]
  );

  return (
    <div className="py-3 border-b border-slate-800/60 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500">
          {label}
        </span>
        {trend && (
          <span className="text-[9px] tabular-nums text-slate-600 whitespace-nowrap">
            {Math.round(trend.min)}–{Math.round(trend.max)} {unit} · {formatTrendSpan(trend.spanSec)}
          </span>
        )}
      </div>
      <VitalTrendBars trend={trend} minRange={minRange} color={color} emptyLabel={emptyLabel} />
    </div>
  );
};

export default VitalTrendBars;
