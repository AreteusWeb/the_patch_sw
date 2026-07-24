import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import useStore from '../../store/useStore';
import MultiChannelWaveformCanvas from './MultiChannelWaveformCanvas';
import { DESKTOP_WAVEFORM_CHANNELS } from './desktopWaveformChannels';
import EcgPaperControls from './EcgPaperControls';
import {
  formatDuration,
  getActivityIntensity,
  getHrZone,
  getHrvProxyMs,
  getWorkoutPhase,
} from '../../utils/fitnessMetrics';
import { cn } from '../../utils/cn';

const MAX_HISTORY_SECONDS = 3600;
const LEAD_II = 1;

const PHASES = [
  { id: 'warm-up', label: 'Warm-up' },
  { id: 'interval', label: 'Interval' },
  { id: 'cool-down', label: 'Cool-down' },
] as const;

interface FitnessCentralAreaProps {
  waveforms: number[][];
}

const FitnessCentralArea: React.FC<FitnessCentralAreaProps> = ({ waveforms }) => {
  const historyOffset = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);
  const vitals = useStore(s => s.vitals);
  const activity = useStore(s => s.activity);
  const isConnected = useStore(s => s.isConnected);
  const hasRealData = useStore(s => s.hasRealData);
  const ecgGridEnabled = useStore(s => s.ecgGridEnabled);
  const ecgPaperSpeed = useStore(s => s.ecgPaperSpeed);
  const ecgGain = useStore(s => s.ecgGain);
  const paperGrid = ecgGridEnabled ? 'subtle' : 'off';

  const isLive = historyOffset === 0;
  const hr = vitals.heartRate.value;
  const zone = getHrZone(hr);
  const intensity = getActivityIntensity(activity, hr);
  const hrv = getHrvProxyMs(hr, hasRealData && isConnected);

  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (!isConnected) return;
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start + historyOffset * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isConnected, historyOffset]);

  // Session phase progress — assume a 3h training window for phase mapping.
  const progress01 = Math.min(1, elapsed / (3 * 3600));
  const activePhase = getWorkoutPhase(progress01);

  const tempDisplay =
    typeof vitals.temperature.value === 'number'
      ? `${vitals.temperature.value}°C`
      : '--';

  const handleSeek = (direction: 'back' | 'forward', amount: number) => {
    const next =
      direction === 'back'
        ? Math.min(historyOffset + amount, MAX_HISTORY_SECONDS)
        : Math.max(0, historyOffset - amount);
    setHistoryOffset(next);
  };

  // Zone bars for combined HR / intensity graph (last 48 Lead II samples as proxy amplitude)
  const zoneSamples = waveforms[LEAD_II]?.slice(-48) ?? [];
  const zoneMin = zoneSamples.length ? Math.min(...zoneSamples) : 0;
  const zoneMax = zoneSamples.length ? Math.max(...zoneSamples) : 1;
  const zoneRange = zoneMax - zoneMin || 1;

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-black overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 py-3 flex flex-col gap-3">
        {/* All channels — single compact canvas */}
        <section className={cn('flex flex-col', ecgGridEnabled ? 'flex-shrink-0' : 'min-h-[360px]')}>
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                All Channels
              </h2>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="text-slate-500">
                  HRV:{' '}
                  <span className="text-teal-400 tabular-nums font-semibold">
                    {hrv != null ? `${hrv} ms` : '--'}
                  </span>
                </span>
                <span style={{ color: zone.color }} className="font-semibold uppercase tracking-wider">
                  {zone.label}
                </span>
                <span className="text-white tabular-nums font-light">
                  {hasRealData && isConnected ? hr : '--'}
                  <span className="text-slate-500 ml-1">bpm</span>
                </span>
              </div>
            </div>
            <EcgPaperControls compact />
          </div>
          <div className={cn(
            'rounded-xl border border-white/5',
            ecgGridEnabled ? 'flex-shrink-0' : 'flex-1 min-h-[360px] overflow-hidden'
          )}>
            <MultiChannelWaveformCanvas
              waveforms={waveforms}
              channels={DESKTOP_WAVEFORM_CHANNELS}
              fill
              minHeight={360}
              paperGrid={paperGrid}
              paperSpeed={ecgPaperSpeed}
              gain={ecgGain}
            />
          </div>
        </section>

        {/* Training metrics (non-waveform) */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            Training Metrics
          </h2>
          <div className="grid grid-cols-1 gap-2">
            <div className="bg-slate-950/60 rounded-lg border border-white/5 px-3 py-2">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                  Activity Intensity
                </span>
                <span
                  className="text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: zone.color }}
                >
                  {intensity.label}
                </span>
              </div>
              <div className="h-6 flex items-end gap-px">
                {Array.from({ length: 40 }).map((_, i) => {
                  const base = intensity.level / 100;
                  const h = Math.max(12, (base * 70 + Math.sin(i * 0.4 + elapsed * 0.05) * 20 + 20));
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-sm"
                      style={{
                        height: `${Math.min(100, h)}%`,
                        backgroundColor: zone.color,
                        opacity: 0.35 + (i / 40) * 0.5,
                      }}
                    />
                  );
                })}
              </div>
            </div>

            <div className="bg-slate-950/60 rounded-lg border border-white/5 px-3 py-2 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                  Temperature
                </span>
                <div className="text-lg font-light text-white tabular-nums mt-0.5">
                  {tempDisplay}
                  {vitals.temperature.trend === 'up' && tempDisplay !== '--' && (
                    <span className="text-[10px] text-teal-400 ml-2 uppercase tracking-wider">
                      Rising – Monitor
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'w-2 h-2 rounded-full',
                      tempDisplay !== '--' && i < 5 ? 'bg-teal-400/70' : 'bg-slate-800'
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Timeline + activity map */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            Timeline + Activity Map
          </h2>
          <div className="bg-slate-950/60 rounded-lg border border-white/5 px-3 py-3">
            <div className="text-[10px] text-slate-500 mb-2 uppercase tracking-wider">
              Workout Phases · Session {formatDuration(elapsed)}
            </div>
            <div className="flex items-center gap-0 mb-3">
              {PHASES.map((phase, i) => {
                const isActive = activePhase === phase.id;
                const isPast =
                  (activePhase === 'interval' && phase.id === 'warm-up') ||
                  (activePhase === 'cool-down' && phase.id !== 'cool-down') ||
                  activePhase === 'complete';
                return (
                  <React.Fragment key={phase.id}>
                    <div
                      className={cn(
                        'flex-1 text-center py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors',
                        isActive
                          ? 'bg-teal-500/25 text-teal-300 border border-teal-500/40'
                          : isPast
                            ? 'bg-slate-800/80 text-slate-400'
                            : 'bg-slate-900 text-slate-600 border border-slate-800'
                      )}
                    >
                      {phase.label}
                    </div>
                    {i < PHASES.length - 1 && (
                      <div className="w-4 h-px bg-slate-700 flex-shrink-0" />
                    )}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>
                Accelerometer · Steps:{' '}
                <span className="text-white tabular-nums font-medium">
                  {activity.steps.toLocaleString()}
                </span>
              </span>
              <span className="text-slate-500">Pace Trend · {activity.activityType}</span>
            </div>
          </div>
        </section>

        {/* HR + Power Zone Graph */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            HR + Intensity Zone
          </h2>
          <div className="bg-slate-950/60 rounded-lg border border-white/5 px-3 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: zone.color }}>
                {zone.label} Zone
              </span>
              <span className="text-[10px] text-slate-500">
                Combined view · Live waveform energy
              </span>
            </div>
            <div className="h-16 flex items-end gap-px">
              {zoneSamples.length >= 2 ? (
                zoneSamples.map((val, i) => {
                  const h = ((val - zoneMin) / zoneRange) * 100;
                  return (
                    <div
                      key={i}
                      className="flex-1 rounded-t-sm"
                      style={{
                        height: `${Math.max(8, h)}%`,
                        backgroundColor: zone.color,
                        opacity: 0.45 + (i / zoneSamples.length) * 0.4,
                      }}
                    />
                  );
                })
              ) : (
                <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-600 italic">
                  Waiting for ECG…
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      {/* Timeline scrubber */}
      <div className="flex-shrink-0 border-t border-slate-800/80 bg-slate-950/60 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => handleSeek('back', 60)}
            className="p-1.5 rounded border border-slate-800 hover:bg-slate-800/50 transition-colors"
            title="1 min back"
          >
            <ChevronLeft size={16} className="text-slate-400" />
          </button>

          <div className="flex-1 flex flex-col gap-1">
            <input
              type="range"
              min={-MAX_HISTORY_SECONDS}
              max={0}
              step={10}
              value={-historyOffset}
              onChange={(e) => setHistoryOffset(-parseInt(e.target.value))}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
            />
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Session Scrubber</span>
              <span className="tabular-nums">{formatDuration(elapsed)} elapsed</span>
            </div>
          </div>

          <button
            onClick={() => handleSeek('forward', 60)}
            className="p-1.5 rounded border border-slate-800 hover:bg-slate-800/50 transition-colors"
            title="1 min forward"
          >
            <ChevronRight size={16} className="text-slate-400" />
          </button>

          <button
            onClick={() => setHistoryOffset(0)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all',
              isLive
                ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-white'
            )}
          >
            ● Live
          </button>
        </div>
      </div>
    </main>
  );
};

export default FitnessCentralArea;
