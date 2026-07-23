import React from 'react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
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
        {hasData ? samples.map((val, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm opacity-80"
            style={{
              height: `${Math.max(8, ((val - min) / range) * 100)}%`,
              backgroundColor: color,
            }}
          />
        )) : (
          <span className="text-[10px] text-slate-600 italic">No data yet</span>
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
    <aside className="w-56 flex-shrink-0 border-l border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <div className="px-4 py-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
          AI Insights
        </h2>
      </div>

      <div className="px-4 pb-4 flex flex-col">
        <ul className="flex flex-col gap-2 pb-3 mb-1 border-b border-slate-800/60">
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
            24H Trends
          </h3>
          <MiniTrendGraph label="Heart Rate" data={waveforms[1]} color="#2dd4bf" />
          <MiniTrendGraph label="SpO2" data={waveforms[10]} color="#5eead4" />
        </div>
      </div>
    </aside>
  );
};

export default DesktopRightSidebar;
