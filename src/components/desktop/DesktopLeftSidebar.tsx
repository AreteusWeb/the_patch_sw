import React from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import type { VitalStatus } from '../../types';
import { useDataFreshness } from '../../hooks/useDataFreshness';
import DataFreshnessBadge from '../DataFreshnessBadge';
import {
  buildTrendBuckets,
  formatTrendSpan,
  QUICK_VITALS_TREND_BARS,
  QUICK_VITALS_TREND_WINDOW_SEC,
  TREND_MIN_RANGE,
  type VitalsTrend,
} from '../../lib/vitalsTrend';
import VitalTrendBars from './VitalTrendBars';

const TrendIcon: React.FC<{ trend: VitalStatus['trend'] }> = ({ trend }) => {
  if (trend === 'up') return <ArrowUp size={10} className="text-amber-400" />;
  if (trend === 'down') return <ArrowDown size={10} className="text-sky-400" />;
  return <Minus size={10} className="text-slate-600" />;
};

interface VitalRowProps {
  label: string;
  status: VitalStatus;
  unit?: string;
  /** Per-second history; omit for vitals with no sensor (empty state, no fake bars). */
  trendValues?: (number | null)[];
  trendMinRange?: number;
  sparkColor?: string;
  barPercent?: number;
}

const VitalRow: React.FC<VitalRowProps> = ({
  label,
  status,
  unit,
  trendValues,
  trendMinRange = 1,
  sparkColor = '#2dd4bf',
  barPercent,
}) => {
  const { freshness, dimmed, isLiveData } = useDataFreshness();
  // NO_DATA → dashes; STALE/DEMO keep last numeric value (dimmed).
  const showDash = freshness === 'NO_DATA';
  const showLiveChrome = isLiveData;

  const trend = React.useMemo(
    () => trendValues
      ? buildTrendBuckets(trendValues, QUICK_VITALS_TREND_WINDOW_SEC, QUICK_VITALS_TREND_BARS)
      : null,
    [trendValues]
  );
  const trendEmptyLabel = !trendValues
    ? 'No sensor'
    : isLiveData ? 'Collecting trend data…' : 'No data yet';

  return (
    <div
      className={cn(
        'py-3 border-b border-slate-800/60 last:border-b-0 transition-opacity duration-300',
        dimmed && 'opacity-50'
      )}
    >
      <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className={cn(
          'text-2xl font-light tabular-nums',
          showDash ? 'text-slate-600' : dimmed ? 'text-slate-400' : 'text-white'
        )}>
          {showDash ? '--' : status.value}
        </span>
        {unit && !showDash && (
          <span className="text-xs text-slate-500">{unit}</span>
        )}
        {showLiveChrome && !showDash && <TrendIcon trend={status.trend} />}
      </div>

      {barPercent != null && !showDash && (
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              dimmed ? 'bg-slate-500/60' : 'bg-teal-500/70'
            )}
            style={{ width: `${Math.min(100, Math.max(0, barPercent))}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <VitalTrendBars
          trend={trend}
          minRange={trendMinRange}
          color={sparkColor}
          muted={dimmed}
          emptyLabel={trendEmptyLabel}
        />
        {trend && (
          <span className="text-[9px] text-slate-600 uppercase tracking-wider flex-shrink-0">
            Last {formatTrendSpan(trend.spanSec)}
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * DesktopLeftSidebar
 * Quick numeric vitals with mini trend sparklines.
 */
interface DesktopLeftSidebarProps {
  vitalsTrend: VitalsTrend;
}

const DesktopLeftSidebar: React.FC<DesktopLeftSidebarProps> = ({ vitalsTrend }) => {
  const vitals = useStore(s => s.vitals);
  const activity = useStore(s => s.activity);
  const { dimmed, freshness, staleAgeLabel } = useDataFreshness();

  const spo2Percent = typeof vitals.spo2.value === 'number' ? vitals.spo2.value : 0;

  return (
    <aside className="hidden min-[1280px]:block w-56 flex-shrink-0 border-r border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-0">
          Quick Vitals
        </h2>
        <DataFreshnessBadge
          freshness={freshness}
          staleAgeLabel={staleAgeLabel}
          compact
        />
      </div>

      <div className="px-4 pb-4">
        <VitalRow
          label="Heart Rate"
          status={vitals.heartRate}
          unit="bpm"
          trendValues={vitalsTrend.hr}
          trendMinRange={TREND_MIN_RANGE.hr}
          sparkColor="#2dd4bf"
        />

        <VitalRow
          label="SpO2"
          status={vitals.spo2}
          unit="%"
          trendValues={vitalsTrend.spo2}
          trendMinRange={TREND_MIN_RANGE.spo2}
          sparkColor="#5eead4"
          barPercent={spo2Percent}
        />

        {/* No BP sensor → no trend (it used to plot the ECG waveform here). */}
        <VitalRow
          label="BP (PTT)"
          status={vitals.bloodPressure}
          sparkColor="#94a3b8"
        />

        <VitalRow
          label="Respiration"
          status={vitals.respirationRate}
          unit="bpm"
          trendValues={vitalsTrend.rr}
          trendMinRange={TREND_MIN_RANGE.rr}
          sparkColor="#5eead4"
        />

        <VitalRow
          label="Temperature"
          status={vitals.temperature}
          unit="°C"
          barPercent={typeof vitals.temperature.value === 'number'
            ? ((vitals.temperature.value - 35) / 3) * 100
            : 0}
        />

        <div className={cn('py-3 transition-opacity duration-300', dimmed && 'opacity-50')}>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Activity
          </div>
          <div className="text-sm text-white font-medium">{activity.activityType}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {activity.steps.toLocaleString()} steps
          </div>
        </div>
      </div>
    </aside>
  );
};

export default DesktopLeftSidebar;
