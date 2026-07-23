import React from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import { getActivityIntensity, getHrZone } from '../../utils/fitnessMetrics';
import type { VitalStatus } from '../../types';

const TrendIcon: React.FC<{ trend: VitalStatus['trend'] }> = ({ trend }) => {
  if (trend === 'up') return <ArrowUp size={10} className="text-amber-400" />;
  if (trend === 'down') return <ArrowDown size={10} className="text-sky-400" />;
  return <Minus size={10} className="text-slate-600" />;
};

const MiniSparkline: React.FC<{ data: number[]; color?: string }> = ({ data, color = '#2dd4bf' }) => {
  const samples = data.slice(-24);
  if (samples.length < 2) {
    return (
      <div className="h-5 flex items-end gap-px">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex-1 bg-slate-800 rounded-sm" style={{ height: `${20 + (i % 3) * 8}%` }} />
        ))}
      </div>
    );
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const range = max - min || 1;
  return (
    <div className="h-5 flex items-end gap-px">
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

interface FitnessLeftSidebarProps {
  waveforms: number[][];
}

const FitnessLeftSidebar: React.FC<FitnessLeftSidebarProps> = ({ waveforms }) => {
  const vitals = useStore(s => s.vitals);
  const activity = useStore(s => s.activity);
  const hasRealData = useStore(s => s.hasRealData);
  const isConnected = useStore(s => s.isConnected);
  const showDash = !hasRealData || !isConnected;

  const hr = vitals.heartRate.value;
  const zone = getHrZone(hr);
  const intensity = getActivityIntensity(activity, hr);
  const spo2Percent = typeof vitals.spo2.value === 'number' ? vitals.spo2.value : 0;

  return (
    <aside className="w-56 flex-shrink-0 border-r border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <div className="px-4 py-3">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
          Key Metrics
        </h2>
      </div>

      <div className="px-4 pb-4 flex flex-col gap-1">
        {/* Heart Rate + Zone */}
        <div className="py-3 border-b border-slate-800/60">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Heart Rate
          </div>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className={cn('text-3xl font-light tabular-nums', showDash ? 'text-slate-600' : 'text-white')}>
              {showDash ? '--' : hr}
            </span>
            {!showDash && <span className="text-xs text-slate-500">bpm</span>}
            {!showDash && <TrendIcon trend={vitals.heartRate.trend} />}
          </div>
          {!showDash && (
            <>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-1.5">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', zone.barClass)}
                  style={{ width: `${zone.intensity}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] mb-2">
                <span style={{ color: zone.color }} className="font-semibold">
                  Zone: {zone.label}
                </span>
              </div>
            </>
          )}
          <MiniSparkline data={waveforms[1]} color={zone.color} />
        </div>

        {/* SpO2 */}
        <div className="py-3 border-b border-slate-800/60">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            SpO2
          </div>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className={cn('text-2xl font-light tabular-nums', showDash ? 'text-slate-600' : 'text-white')}>
              {showDash ? '--' : vitals.spo2.value}
            </span>
            {!showDash && <span className="text-xs text-slate-500">%</span>}
          </div>
          {!showDash && (
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-400/80 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, spo2Percent)}%` }}
              />
            </div>
          )}
        </div>

        {/* BP */}
        <div className="py-3 border-b border-slate-800/60">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            BP (PTT)
          </div>
          <div className={cn('text-2xl font-light tabular-nums', showDash ? 'text-slate-600' : 'text-white')}>
            {showDash ? '--' : vitals.bloodPressure.value}
          </div>
        </div>

        {/* Respiration */}
        <div className="py-3 border-b border-slate-800/60">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Respiration
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={cn('text-2xl font-light tabular-nums', showDash ? 'text-slate-600' : 'text-white')}>
              {showDash ? '--' : vitals.respirationRate.value}
            </span>
            {!showDash && <span className="text-xs text-slate-500">bpm</span>}
          </div>
        </div>

        {/* Temperature */}
        <div className="py-3 border-b border-slate-800/60">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Temperature
          </div>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className={cn('text-2xl font-light tabular-nums', showDash || vitals.temperature.value === '--' ? 'text-slate-600' : 'text-white')}>
              {showDash || vitals.temperature.value === '--'
                ? '--'
                : `${vitals.temperature.value}°C`}
            </span>
            {!showDash && vitals.temperature.value !== '--' && (
              <TrendIcon trend={vitals.temperature.trend} />
            )}
          </div>
        </div>

        {/* Activity */}
        <div className="py-3">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Activity / Movement
          </div>
          <div className="text-sm text-white font-medium">
            {intensity.label} • {activity.steps.toLocaleString()} steps
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">
            {activity.activityType} • Posture: Upright
          </div>
          <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-400/80 rounded-full transition-all duration-500"
              style={{ width: `${intensity.level}%` }}
            />
          </div>
        </div>
      </div>
    </aside>
  );
};

export default FitnessLeftSidebar;
