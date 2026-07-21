import React from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import type { VitalStatus } from '../../types';

const TrendIcon: React.FC<{ trend: VitalStatus['trend'] }> = ({ trend }) => {
  if (trend === 'up') return <ArrowUp size={10} className="text-amber-400" />;
  if (trend === 'down') return <ArrowDown size={10} className="text-sky-400" />;
  return <Minus size={10} className="text-slate-600" />;
};

const MiniSparkline: React.FC<{ data: number[]; color?: string }> = ({ data, color = '#2dd4bf' }) => {
  const samples = data.slice(-24);
  if (samples.length < 2) {
    return <div className="h-6 flex items-end gap-px">{Array.from({ length: 12 }).map((_, i) => (
      <div key={i} className="flex-1 bg-slate-800 rounded-sm" style={{ height: `${20 + (i % 3) * 8}%` }} />
    ))}</div>;
  }

  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;

  return (
    <div className="h-6 flex items-end gap-px">
      {samples.map((val, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm opacity-80"
          style={{
            height: `${Math.max(8, ((val - min) / range) * 100)}%`,
            backgroundColor: color,
          }}
        />
      ))}
    </div>
  );
};

interface VitalRowProps {
  label: string;
  status: VitalStatus;
  unit?: string;
  sparkData?: number[];
  sparkColor?: string;
  barPercent?: number;
}

const VitalRow: React.FC<VitalRowProps> = ({
  label,
  status,
  unit,
  sparkData = [],
  sparkColor,
  barPercent,
}) => {
  const hasRealData = useStore(s => s.hasRealData);
  const isConnected = useStore(s => s.isConnected);
  const showDash = !hasRealData || !isConnected;

  return (
    <div className="py-3 border-b border-slate-800/60 last:border-b-0">
      <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5 mb-2">
        <span className={cn(
          'text-2xl font-light tabular-nums',
          showDash ? 'text-slate-600' : 'text-white'
        )}>
          {showDash ? '--' : status.value}
        </span>
        {unit && !showDash && (
          <span className="text-xs text-slate-500">{unit}</span>
        )}
        {!showDash && <TrendIcon trend={status.trend} />}
      </div>

      {barPercent != null && !showDash && (
        <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-teal-500/70 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, barPercent))}%` }}
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <MiniSparkline data={sparkData} color={sparkColor} />
        {!showDash && (
          <span className="text-[9px] text-slate-600 uppercase tracking-wider flex-shrink-0">
            Trend
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * DesktopLeftSidebar
 * Vitals numéricos de un vistazo con mini-tendencias.
 */
interface DesktopLeftSidebarProps {
  waveforms: number[][];
}

const DesktopLeftSidebar: React.FC<DesktopLeftSidebarProps> = ({ waveforms }) => {
  const vitals = useStore(s => s.vitals);
  const activity = useStore(s => s.activity);

  const spo2Percent = typeof vitals.spo2.value === 'number' ? vitals.spo2.value : 0;

  return (
    <aside className="w-56 flex-shrink-0 border-r border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <div className="px-4 py-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500 mb-1">
          Quick Vitals
        </h2>
      </div>

      <div className="px-4 pb-4">
        <VitalRow
          label="Heart Rate"
          status={vitals.heartRate}
          unit="bpm"
          sparkData={waveforms[1]}
          sparkColor="#2dd4bf"
        />

        <VitalRow
          label="SpO2"
          status={vitals.spo2}
          unit="%"
          sparkData={waveforms[9]}
          sparkColor="#5eead4"
          barPercent={spo2Percent}
        />

        <VitalRow
          label="BP (PTT)"
          status={vitals.bloodPressure}
          sparkData={waveforms[1]}
          sparkColor="#94a3b8"
        />

        <VitalRow
          label="Respiration"
          status={vitals.respirationRate}
          unit="bpm"
          sparkData={waveforms[8]}
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

        <div className="py-3">
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
