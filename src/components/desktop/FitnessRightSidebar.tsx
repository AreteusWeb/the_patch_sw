import React from 'react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import {
  getHrZone,
  getHrvProxyMs,
  getReadinessLabel,
  getRecoveryScore,
} from '../../utils/fitnessMetrics';
import type { Vitals } from '../../types';

const severityColor: Record<string, string> = {
  high: 'border-rose-500/30 bg-rose-500/10',
  medium: 'border-yellow-500/25 bg-yellow-500/10',
  low: 'border-slate-800/80 bg-slate-900/30',
};

const MiniTrendGraph: React.FC<{ data: number[]; color: string; label: string }> = ({
  data,
  color,
  label,
}) => {
  const samples = data.slice(-24);
  const hasData = samples.length >= 2;
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
          <span className="text-[10px] text-slate-600 italic">No data yet</span>
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

interface FitnessRightSidebarProps {
  waveforms: number[][];
}

const FitnessRightSidebar: React.FC<FitnessRightSidebarProps> = ({ waveforms }) => {
  const alerts = useStore(s => s.alerts);
  const vitals = useStore(s => s.vitals);
  const hasRealData = useStore(s => s.hasRealData);
  const isConnected = useStore(s => s.isConnected);
  const live = hasRealData && isConnected;

  const recovery = getRecoveryScore(vitals, live);
  const hrv = getHrvProxyMs(vitals.heartRate.value, live);
  const readiness = getReadinessLabel(recovery.score, live);
  const notes = React.useMemo(
    () => buildPerformanceNotes(vitals, live),
    [vitals, live]
  );
  const activeAlerts = alerts.slice(0, 4);
  const recoveryTrend = waveforms[1]?.slice(-48) ?? [];

  return (
    <aside className="w-56 flex-shrink-0 border-l border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <div className="px-4 py-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
          Recovery Insights
        </h2>
      </div>

      <div className="px-4 pb-4 flex flex-col">
        <ul className="flex flex-col gap-2 pb-3 mb-1 border-b border-slate-800/60 text-[11px] text-slate-300">
          <li className="flex items-start gap-2">
            <span className="text-teal-500 mt-0.5">•</span>
            <span>
              HRV:{' '}
              <span className="text-white font-medium tabular-nums">
                {hrv != null ? `${hrv} ms` : '--'}
              </span>
              {hrv != null && (
                <span className="text-teal-400/80">
                  {' '}
                  ({hrv >= 55 ? 'Good' : 'Low'})
                </span>
              )}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-teal-500 mt-0.5">•</span>
            <span>
              Readiness: <span className="text-white font-medium">{readiness}</span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-teal-500 mt-0.5">•</span>
            <span>
              Sleep Quality Impact:{' '}
              <span className="text-slate-500 italic">Pending sleep sync</span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-teal-500 mt-0.5">•</span>
            <span>
              Recovery Score:{' '}
              <span className="text-white font-medium tabular-nums">
                {live ? `${recovery.score}/100` : '--'}
              </span>
              {live && (
                <span className="text-teal-400/90"> ({recovery.label})</span>
              )}
            </span>
          </li>
        </ul>

        <div className="py-3 border-b border-slate-800/60">
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
            <div className="flex flex-col gap-2">
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    'px-3 py-2 rounded-lg border text-[10px]',
                    severityColor[alert.severity] ?? severityColor.low
                  )}
                >
                  <div className="text-slate-500 tabular-nums mb-0.5">{alert.timestamp}</div>
                  <div className="text-white font-medium">{alert.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-1">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1 pt-2">
            24H / Session Trends
          </h3>
          <MiniTrendGraph label="HR Trend" data={waveforms[1]} color="#2dd4bf" />
          <MiniTrendGraph label="Recovery Score Trend" data={recoveryTrend} color="#5eead4" />
        </div>
      </div>
    </aside>
  );
};

export default FitnessRightSidebar;
