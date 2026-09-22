import React from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import { formatSessionClock, getHrZone } from '../../utils/fitnessMetrics';
import { useFitnessSessionElapsed } from '../../hooks/useFitnessSessionElapsed';
import type { VitalStatus } from '../../types';
import { useDataFreshness } from '../../hooks/useDataFreshness';
import DataFreshnessBadge from '../DataFreshnessBadge';

const TrendIcon: React.FC<{ trend: VitalStatus['trend'] }> = ({ trend }) => {
  if (trend === 'up') return <ArrowUp size={10} className="text-amber-400" />;
  if (trend === 'down') return <ArrowDown size={10} className="text-sky-400" />;
  return <Minus size={10} className="text-slate-600" />;
};

const MiniSparkline: React.FC<{ data: number[]; color?: string; muted?: boolean }> = ({
  data,
  color = '#2dd4bf',
  muted = false,
}) => {
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
    <div className={cn('h-5 flex items-end gap-px', muted && 'opacity-45')}>
      {samples.map((val, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm opacity-80"
          style={{
            height: `${Math.max(8, ((val - min) / range) * 100)}%`,
            backgroundColor: muted ? '#64748b' : color,
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
  const fitnessSessionStatus = useStore(s => s.fitnessSessionStatus);
  const elapsed = useFitnessSessionElapsed();
  const { freshness, dimmed, isLiveData, staleAgeLabel } = useDataFreshness();
  const showDash = freshness === 'NO_DATA';

  const hr = vitals.heartRate.value;
  const zone = getHrZone(hr);
  const spo2Percent = typeof vitals.spo2.value === 'number' ? vitals.spo2.value : 0;

  const sessionStatusLabel =
    fitnessSessionStatus === 'recording' ? 'Recording'
      : fitnessSessionStatus === 'paused' ? 'Paused'
        : fitnessSessionStatus === 'ended' ? 'Ended'
          : 'Idle';

  return (
    <aside className="hidden min-[1280px]:block w-56 flex-shrink-0 border-r border-slate-800/80 bg-slate-950/40 overflow-y-auto scrollbar-hide">
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-500">
          Key Metrics
        </h2>
        <DataFreshnessBadge
          freshness={freshness}
          staleAgeLabel={staleAgeLabel}
          compact
        />
      </div>

      <div className="px-4 pb-4 flex flex-col gap-1">
        <div className={cn('py-3 border-b border-slate-800/60 transition-opacity duration-300', dimmed && 'opacity-50')}>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Heart Rate
          </div>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className={cn(
              'text-3xl font-light tabular-nums',
              showDash ? 'text-slate-600' : dimmed ? 'text-slate-400' : 'text-white'
            )}>
              {showDash ? '--' : hr}
            </span>
            {!showDash && <span className="text-xs text-slate-500">bpm</span>}
            {isLiveData && !showDash && <TrendIcon trend={vitals.heartRate.trend} />}
          </div>
          {!showDash && (
            <>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-1.5">
                <div
                  className={cn(
                    'h-full rounded-full transition-all duration-500',
                    dimmed ? 'bg-slate-500/60' : zone.barClass
                  )}
                  style={{ width: `${zone.intensity}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] mb-2">
                <span
                  style={{ color: dimmed ? '#94a3b8' : zone.color }}
                  className="font-semibold"
                >
                  Zone: {zone.label}
                </span>
              </div>
            </>
          )}
          <MiniSparkline data={waveforms[1]} color={zone.color} muted={dimmed} />
        </div>

        <div className={cn('py-3 border-b border-slate-800/60 transition-opacity duration-300', dimmed && 'opacity-50')}>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            SpO2
          </div>
          <div className="flex items-baseline gap-1.5 mb-2">
            <span className={cn(
              'text-2xl font-light tabular-nums',
              showDash ? 'text-slate-600' : dimmed ? 'text-slate-400' : 'text-white'
            )}>
              {showDash ? '--' : vitals.spo2.value}
            </span>
            {!showDash && <span className="text-xs text-slate-500">%</span>}
          </div>
          {!showDash && (
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  dimmed ? 'bg-slate-500/60' : 'bg-teal-400/80'
                )}
                style={{ width: `${Math.min(100, spo2Percent)}%` }}
              />
            </div>
          )}
        </div>

        <div className={cn('py-3 border-b border-slate-800/60 transition-opacity duration-300', dimmed && 'opacity-50')}>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            BP (PTT)
          </div>
          <div className={cn(
            'text-2xl font-light tabular-nums',
            showDash ? 'text-slate-600' : dimmed ? 'text-slate-400' : 'text-white'
          )}>
            {showDash ? '--' : vitals.bloodPressure.value}
          </div>
        </div>

        <div className={cn('py-3 border-b border-slate-800/60 transition-opacity duration-300', dimmed && 'opacity-50')}>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Respiration
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={cn(
              'text-2xl font-light tabular-nums',
              showDash ? 'text-slate-600' : dimmed ? 'text-slate-400' : 'text-white'
            )}>
              {showDash ? '--' : vitals.respirationRate.value}
            </span>
            {!showDash && <span className="text-xs text-slate-500">bpm</span>}
          </div>
        </div>

        {/* Session clock — real Start Session state (replaces fake steps/activity) */}
        <div className="py-3">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-500 mb-1.5">
            Session
          </div>
          <div className="text-2xl font-light tabular-nums text-white">
            {formatSessionClock(elapsed)}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5 uppercase tracking-wider">
            {sessionStatusLabel}
          </div>
        </div>
      </div>
    </aside>
  );
};

export default FitnessLeftSidebar;
