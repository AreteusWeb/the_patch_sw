import React from 'react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import type { CoachInsightsState } from '../../hooks/useCoachInsights';
import type { Vitals } from '../../types';
import { useDataFreshness } from '../../hooks/useDataFreshness';
import { TREND_MIN_RANGE, type VitalsTrend } from '../../lib/vitalsTrend';
import SidebarPanelHeader from './SidebarPanelHeader';
import { SessionTrendRow } from './VitalTrendBars';

const severityColor: Record<string, string> = {
  high: 'border-rose-500/30 bg-rose-500/10',
  medium: 'border-yellow-500/25 bg-yellow-500/10',
  low: 'border-slate-800/80 bg-slate-900/30',
};

/**
 * Local fallback when the insights API fails before any successful reply.
 * Only echoes measured numbers: no rhythm claims (rhythm is never analyzed),
 * no temperature (no sensor), no diagnoses. SpO2 is omitted because
 * estimateSpO2 is an uncalibrated single-channel PPG estimate.
 */
function buildAiInsights(vitals: Vitals, hasRealData: boolean): string[] {
  if (!hasRealData) {
    return ['Awaiting live sensor data…'];
  }

  const lines = ['AI insights unavailable — showing current readings.'];

  const hr = vitals.heartRate.value;
  if (typeof hr === 'number' && hr > 0) {
    lines.push(`Heart rate: ${hr} bpm`);
  }

  const rr = vitals.respirationRate.value;
  if (typeof rr === 'number' && rr > 0) {
    lines.push(`Respiration: ${rr} breaths/min`);
  }

  if (lines.length === 1) {
    lines.push('No readings available yet.');
  }

  return lines;
}

function resolveInsightLines(
  insights: CoachInsightsState,
  vitals: Vitals,
  live: boolean
): string[] {
  if (!live) {
    return ['Live sensor required for AI insights — reconnect The Patch.'];
  }
  if (insights.bullets && insights.bullets.length > 0) return insights.bullets;
  if (insights.status === 'analyzing' || insights.loading) return ['Analyzing...'];
  if (insights.status === 'error') return buildAiInsights(vitals, live);
  return ['Analyzing...'];
}

interface DesktopRightSidebarProps {
  vitalsTrend: VitalsTrend;
  insights: CoachInsightsState;
}

const DesktopRightSidebar: React.FC<DesktopRightSidebarProps> = ({
  vitalsTrend,
  insights,
}) => {
  const alerts = useStore(s => s.alerts);
  const vitals = useStore(s => s.vitals);
  const { isLiveData, dimmed, freshness, staleAgeLabel } = useDataFreshness();

  const aiInsights = resolveInsightLines(insights, vitals, isLiveData);
  const activeAlerts = alerts;

  return (
    <aside className="hidden min-[1280px]:block w-56 flex-shrink-0 border-l border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <SidebarPanelHeader
        title="AI Insights"
        freshness={freshness}
        staleAgeLabel={staleAgeLabel}
      />

      <div className="px-4 pb-4 flex flex-col">
        <ul className={cn(
          'flex flex-col gap-2 pb-3 mb-1 border-b border-slate-800/60 transition-opacity duration-300',
          dimmed && 'opacity-50'
        )}>
          {aiInsights.map((insight) => (
            <li
              key={insight}
              className="flex items-start gap-2 text-[11px] text-slate-300 leading-snug"
            >
              <span className="text-teal-500 mt-0.5 flex-shrink-0">•</span>
              {insight}
            </li>
          ))}
        </ul>

        <div className="py-3 border-b border-slate-800/60">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
            Active Alerts
          </h3>
          {activeAlerts.length === 0 ? (
            <p className="text-[11px] text-slate-600 italic">None currently</p>
          ) : (
            /* Fixed height ≈ 3 alert rows; scroll for the rest (same as mobile) */
            <div className="flex flex-col gap-2 h-[168px] overflow-y-auto overscroll-contain scrollbar-hide">
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    'px-3 py-2 rounded-lg border text-[10px] flex-shrink-0',
                    alert.historical
                      ? 'border-slate-700/60 bg-slate-900/40 opacity-60'
                      : (severityColor[alert.severity] ?? severityColor.low)
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="text-slate-500 tabular-nums">{alert.timestamp}</div>
                    {alert.historical && (
                      <span className="text-[8px] font-bold uppercase tracking-wider text-slate-500">
                        Historical
                      </span>
                    )}
                  </div>
                  <div className={cn(
                    'font-medium',
                    alert.historical ? 'text-slate-400' : 'text-white'
                  )}>
                    {alert.message}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={cn('pt-1 transition-opacity duration-300', dimmed && 'opacity-50')}>
          <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1 pt-2">
            Session Trends
          </h3>
          <SessionTrendRow
            label="Heart Rate"
            values={vitalsTrend.hr}
            unit="bpm"
            minRange={TREND_MIN_RANGE.hr}
            color={dimmed ? '#64748b' : '#2dd4bf'}
            emptyLabel={isLiveData ? 'Collecting trend data…' : 'No data yet'}
          />
          {/* Same uncalibrated SpO2 estimate shown in Quick Vitals, plotted over time. */}
          <SessionTrendRow
            label="SpO2"
            values={vitalsTrend.spo2}
            unit="%"
            minRange={TREND_MIN_RANGE.spo2}
            color={dimmed ? '#64748b' : '#5eead4'}
            emptyLabel={isLiveData ? 'Collecting trend data…' : 'No data yet'}
          />
        </div>
      </div>
    </aside>
  );
};

export default DesktopRightSidebar;
