import React from 'react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import { getHrZone } from '../../utils/fitnessMetrics';
import {
  describeTrainingLoad,
  TRAINING_LOAD_WINDOW_DAYS,
  type TrainingLoadState,
} from '../../lib/trainingLoad';
import type { CoachInsightsState } from '../../hooks/useCoachInsights';
import type { Vitals } from '../../types';
import { useDataFreshness } from '../../hooks/useDataFreshness';
import SidebarPanelHeader from './SidebarPanelHeader';

const severityColor: Record<string, string> = {
  high: 'border-rose-500/30 bg-rose-500/10',
  medium: 'border-yellow-500/25 bg-yellow-500/10',
  low: 'border-slate-800/80 bg-slate-900/30',
};

const MiniTrendGraph: React.FC<{
  data: number[];
  color: string;
  label: string;
  minPoints?: number;
  emptyLabel?: string;
  window?: number;
}> = ({
  data,
  color,
  label,
  minPoints = 2,
  emptyLabel = 'No data yet',
  window = 24,
}) => {
  const samples = data.slice(-window);
  const hasData = samples.length >= minPoints;
  const min = hasData ? Math.min(...samples) : 0;
  const max = hasData ? Math.max(...samples) : 1;
  const range = max - min || 1;

  return (
    <div className="py-3 border-b border-slate-800/60 last:border-b-0">
      <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
        {label}
      </div>
      <div className="h-6 flex items-end gap-px">
        {hasData ? (
          samples.map((val, i) => (
            <div
              key={i}
              className="flex-1 rounded-sm opacity-80"
              style={{
                height: `${Math.max(8, ((val - min) / range) * 100)}%`,
                backgroundColor: color,
              }}
            />
          ))
        ) : (
          <span className="text-[10px] text-slate-600 italic">{emptyLabel}</span>
        )}
      </div>
    </div>
  );
};

function buildPerformanceNotes(vitals: Vitals, hasRealData: boolean): string[] {
  if (!hasRealData) return ['Connect The Patch to unlock AI coach notes…'];

  const notes: string[] = [];
  const zone = getHrZone(vitals.heartRate.value);

  if (zone.id === 'high' || zone.id === 'peak') {
    notes.push('Optimal HR zone detected for interval training');
  } else if (zone.id === 'cardio') {
    notes.push('Solid cardio zone — sustain for aerobic gains');
  } else if (zone.id === 'fat_burn') {
    notes.push('Fat-burn zone active — good for endurance base');
  } else {
    notes.push('Recovery pace — good window for warm-up or cool-down');
  }

  if (typeof vitals.spo2.value === 'number' && vitals.spo2.value < 95) {
    notes.push('Minor desaturation during effort — ease intensity if it persists');
  } else if (typeof vitals.spo2.value === 'number') {
    notes.push('Oxygen saturation holding steady under load');
  }

  if (typeof vitals.respirationRate.value === 'number' && vitals.respirationRate.value > 24) {
    notes.push('Elevated breathing rate — focus on controlled exhales');
  }

  if (vitals.temperature.trend === 'up' && typeof vitals.temperature.value === 'number') {
    notes.push('Skin temp trending up — hydrate and monitor');
  }

  return notes.slice(0, 4);
}

function resolvePerformanceNotes(
  insights: CoachInsightsState,
  vitals: Vitals,
  live: boolean
): string[] {
  if (!live) {
    return ['Live sensor required for performance notes — reconnect The Patch.'];
  }
  if (insights.bullets && insights.bullets.length > 0) return insights.bullets;
  if (insights.status === 'analyzing' || insights.loading) return ['Analyzing...'];
  if (insights.status === 'error') return buildPerformanceNotes(vitals, live);
  return ['Analyzing...'];
}

const TRAINING_LOAD_LEVEL_COLOR: Record<'high' | 'moderate' | 'low', string> = {
  high: 'text-teal-300',
  moderate: 'text-teal-400',
  low: 'text-slate-300',
};

/**
 * Last-7-days activity summary from recorded training sessions. Not live
 * sensor data, so it is never dimmed by the LIVE/STALE badge.
 */
const TrainingLoadBlock: React.FC<{ trainingLoad: TrainingLoadState }> = ({
  trainingLoad,
}) => {
  let body: React.ReactNode;
  switch (trainingLoad.status) {
    case 'ready': {
      const { summary } = trainingLoad;
      body = (
        <>
          <div className={cn('text-sm font-semibold', TRAINING_LOAD_LEVEL_COLOR[summary.level])}>
            {summary.label}
          </div>
          <p className="text-[11px] text-slate-300 leading-snug mt-0.5">
            {describeTrainingLoad(summary)}
          </p>
        </>
      );
      break;
    }
    case 'no_recent_activity':
      body = (
        <>
          <p className="text-[11px] text-slate-300">No recent sessions recorded</p>
          <p className="text-[10px] text-slate-600 leading-snug mt-0.5">
            Finish a training session to see your weekly load.
          </p>
        </>
      );
      break;
    case 'unavailable':
      body = (
        <p className="text-[11px] text-slate-500 leading-snug">
          {trainingLoad.reason === 'local_mode'
            ? "Training history isn't saved in local mode."
            : 'Sign in to see your training load.'}
        </p>
      );
      break;
    case 'error':
      body = (
        <p className="text-[11px] text-slate-500 leading-snug">
          Couldn't load your training history.
        </p>
      );
      break;
    default:
      body = <p className="text-[11px] text-slate-600 italic">Loading…</p>;
  }

  return (
    <div className="pb-3 mb-1 border-b border-slate-800/60">
      <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
        Training Load · Last {TRAINING_LOAD_WINDOW_DAYS} days
      </h3>
      {body}
    </div>
  );
};

interface FitnessRightSidebarProps {
  waveforms: number[][];
  insights: CoachInsightsState;
}

const FitnessRightSidebar: React.FC<FitnessRightSidebarProps> = ({
  waveforms,
  insights,
}) => {
  const alerts = useStore(s => s.alerts);
  const vitals = useStore(s => s.vitals);
  const trainingLoad = useStore(s => s.trainingLoad);
  const { isLiveData, dimmed, freshness, staleAgeLabel } = useDataFreshness();
  const live = isLiveData;

  const notes = resolvePerformanceNotes(insights, vitals, live);
  const activeAlerts = alerts;

  return (
    <aside className="hidden min-[1280px]:block w-56 flex-shrink-0 border-l border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <SidebarPanelHeader
        title="Performance Insights"
        freshness={freshness}
        staleAgeLabel={staleAgeLabel}
      />

      <div className="px-4 pb-4 flex flex-col">
        <TrainingLoadBlock trainingLoad={trainingLoad} />

        <div className={cn(
          'py-3 border-b border-slate-800/60 transition-opacity duration-300',
          dimmed && 'opacity-50'
        )}>
          <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
            AI Performance Notes
          </h3>
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li
                key={note}
                className="flex items-start gap-2 text-[11px] text-slate-300 leading-snug"
              >
                <span className="text-teal-500 mt-0.5 flex-shrink-0">•</span>
                {note}
              </li>
            ))}
          </ul>
        </div>

        <div className="py-3 border-b border-slate-800/60">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-2">
            Live Alerts
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
          <MiniTrendGraph
            label="HR Trend"
            data={waveforms[1]}
            color={dimmed ? '#64748b' : '#2dd4bf'}
          />
        </div>
      </div>
    </aside>
  );
};

export default FitnessRightSidebar;
