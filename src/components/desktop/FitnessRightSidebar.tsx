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
  high: 'border-red-500/40 bg-red-500/10',
  medium: 'border-yellow-500/30 bg-yellow-500/10',
  low: 'border-white/10 bg-slate-900/30',
};

const MiniTrendGraph: React.FC<{ data: number[]; color: string; label: string }> = ({
  data,
  color,
  label,
}) => {
  const samples = data.slice(-48);
  const hasData = samples.length >= 2;
  const min = hasData ? Math.min(...samples) : 0;
  const max = hasData ? Math.max(...samples) : 1;
  const range = max - min || 1;

  return (
    <div className="bg-slate-950/60 rounded-lg border border-white/5 p-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1.5">
        {label}
      </div>
      <div className="h-12 flex items-end gap-px">
        {hasData ? (
          samples.map((val, i) => (
            <div
              key={i}
              className="flex-1 rounded-t-sm"
              style={{
                height: `${Math.max(6, ((val - min) / range) * 100)}%`,
                backgroundColor: color,
                opacity: 0.7,
              }}
            />
          ))
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[9px] text-slate-600 italic">
            No data yet
          </div>
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

  // Synthetic recovery trend bars from recovery score + HR energy
  const recoveryTrend = waveforms[1]?.slice(-48) ?? [];

  return (
    <aside className="w-64 flex-shrink-0 border-l border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <div className="px-4 py-3 flex flex-col gap-5">
        {/* Recovery Insights */}
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
            Recovery Insights
          </h2>
          <ul className="flex flex-col gap-2 text-[11px] text-slate-300">
            <li className="flex items-start gap-2">
              <span className="text-teal-500 mt-0.5">•</span>
              <span>
                HRV:{' '}
                <span className="text-white font-medium tabular-nums">
                  {hrv != null ? `${hrv} ms` : '--'}
                </span>
                {hrv != null && (
                  <span className="text-emerald-400/80">
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
                  <span className="text-emerald-400/90"> ({recovery.label})</span>
                )}
              </span>
            </li>
          </ul>
        </section>

        {/* AI Performance Notes */}
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
            AI Performance Notes
          </h2>
          <ul className="flex flex-col gap-2">
            {notes.map((note) => (
              <li
                key={note}
                className="flex items-start gap-2 text-[11px] text-slate-300 leading-snug"
              >
                <span className="text-amber-400/80 mt-0.5 flex-shrink-0">•</span>
                {note}
              </li>
            ))}
          </ul>
        </section>

        {/* Live Alerts */}
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
            Live Alerts
          </h2>
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
        </section>

        {/* Session Trends */}
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
            24H / Session Trends
          </h2>
          <div className="flex flex-col gap-2">
            <MiniTrendGraph label="HR Trend" data={waveforms[1]} color="#2dd4bf" />
            <MiniTrendGraph
              label="Recovery Score Trend"
              data={recoveryTrend}
              color="#34d399"
            />
          </div>
        </section>
      </div>
    </aside>
  );
};

export default FitnessRightSidebar;
