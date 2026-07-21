import React from 'react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
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
        {hasData ? samples.map((val, i) => (
          <div
            key={i}
            className="flex-1 rounded-t-sm"
            style={{
              height: `${Math.max(6, ((val - min) / range) * 100)}%`,
              backgroundColor: color,
              opacity: 0.7,
            }}
          />
        )) : (
          <div className="w-full h-full flex items-center justify-center text-[9px] text-slate-600 italic">
            No data yet
          </div>
        )}
      </div>
    </div>
  );
};

function buildAiInsights(vitals: Vitals, hasRealData: boolean): string[] {
  if (!hasRealData) {
    return ['Awaiting live sensor data…'];
  }

  const insights: string[] = [];

  if (vitals.heartRate.severity === 'normal') {
    insights.push('Normal sinus rhythm');
  } else if (vitals.heartRate.trend === 'up') {
    insights.push('Elevated heart rate detected');
  } else {
    insights.push('Bradycardia pattern noted');
  }

  if (vitals.respirationRate.severity === 'normal') {
    insights.push('Respiration stable');
  } else {
    insights.push('Abnormal respiratory pattern');
  }

  if (vitals.temperature.trend === 'up' && vitals.temperature.severity !== 'normal') {
    insights.push('Mild temp rise noted');
  } else if (vitals.temperature.severity === 'normal') {
    insights.push('Temperature within range');
  }

  if (vitals.spo2.severity !== 'normal') {
    insights.push('SpO2 below threshold');
  }

  return insights.slice(0, 4);
}

/**
 * DesktopRightSidebar
 * Inteligencia accionable: AI insights, alertas activas y tendencias 24h.
 */
interface DesktopRightSidebarProps {
  waveforms: number[][];
}

const DesktopRightSidebar: React.FC<DesktopRightSidebarProps> = ({ waveforms }) => {
  const alerts = useStore(s => s.alerts);
  const vitals = useStore(s => s.vitals);
  const hasRealData = useStore(s => s.hasRealData);

  const aiInsights = React.useMemo(
    () => buildAiInsights(vitals, hasRealData),
    [vitals, hasRealData]
  );

  const activeAlerts = alerts.slice(0, 5);

  return (
    <aside className="w-64 flex-shrink-0 border-l border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <div className="px-4 py-3 flex flex-col gap-5">
        {/* AI Insights */}
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
            AI Insights
          </h2>
          <ul className="flex flex-col gap-2">
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
        </section>

        {/* Active Alerts */}
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
            Active Alerts
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

        {/* 24H Trends */}
        <section>
          <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-2">
            24H Trends
          </h2>
          <div className="flex flex-col gap-2">
            <MiniTrendGraph
              label="Heart Rate"
              data={waveforms[1]}
              color="#2dd4bf"
            />
            <MiniTrendGraph
              label="SpO2"
              data={waveforms[9]}
              color="#5eead4"
            />
          </div>
        </section>
      </div>
    </aside>
  );
};

export default DesktopRightSidebar;
