import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import useStore from '../../store/useStore';
import MultiChannelWaveformCanvas from './MultiChannelWaveformCanvas';
import { DESKTOP_WAVEFORM_CHANNELS } from './desktopWaveformChannels';
import EcgPaperControls from './EcgPaperControls';
import {
  formatSessionClock,
  getHrZone,
  getHrvProxyMs,
} from '../../utils/fitnessMetrics';
import { zoneColorForLabel } from '../../lib/sessionSummary';
import { useFitnessSessionElapsed } from '../../hooks/useFitnessSessionElapsed';
import { cn } from '../../utils/cn';
import { useDataFreshness } from '../../hooks/useDataFreshness';
import DataFreshnessBadge from '../DataFreshnessBadge';

const MAX_HISTORY_SECONDS = 3600;

interface FitnessCentralAreaProps {
  waveforms: number[][];
}

/**
 * Fitness center: live multi-channel waveforms + training session strip + scrubber.
 * Placeholder panels (fake intensity / map / zone bars) were removed — they had no real data.
 */
const FitnessCentralArea: React.FC<FitnessCentralAreaProps> = ({ waveforms }) => {
  const historyOffset = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);
  const vitals = useStore(s => s.vitals);
  const ecgGridEnabled = useStore(s => s.ecgGridEnabled);
  const ecgPaperSpeed = useStore(s => s.ecgPaperSpeed);
  const ecgGain = useStore(s => s.ecgGain);
  const paperGrid = ecgGridEnabled ? 'subtle' : 'off';

  const isLive = historyOffset === 0;
  const { freshness, dimmed, isLiveData, staleAgeLabel } = useDataFreshness();
  const hr = vitals.heartRate.value;
  const zone = getHrZone(hr);
  const hrv = getHrvProxyMs(hr, isLiveData);
  const fitnessSessionStatus = useStore(s => s.fitnessSessionStatus);
  const fitnessSessionSummary = useStore(s => s.fitnessSessionSummary);
  const resetFitnessSessionToIdle = useStore(s => s.resetFitnessSessionToIdle);
  const elapsed = useFitnessSessionElapsed();

  const zoneAccent = dimmed ? '#64748b' : zone.color;
  const channelsCanvasHeight = ecgGridEnabled ? undefined : 420;
  const showSummary = fitnessSessionStatus === 'ended';

  const sessionStatusLabel =
    fitnessSessionStatus === 'recording' ? 'Recording'
      : fitnessSessionStatus === 'paused' ? 'Paused'
        : fitnessSessionStatus === 'ended' ? 'Summary'
          : 'Idle';

  const sessionStatusColor =
    fitnessSessionStatus === 'recording' ? 'text-teal-400'
      : fitnessSessionStatus === 'paused' ? 'text-amber-400'
        : fitnessSessionStatus === 'ended' ? 'text-slate-300'
          : 'text-slate-500';

  const handleSeek = (direction: 'back' | 'forward', amount: number) => {
    const next =
      direction === 'back'
        ? Math.min(historyOffset + amount, MAX_HISTORY_SECONDS)
        : Math.max(0, historyOffset - amount);
    setHistoryOffset(next);
  };

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-black overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 py-3 flex flex-col gap-3">
        {/* Live multi-channel waveforms */}
        <section className="relative z-10 flex flex-col flex-shrink-0 isolate">
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                All Channels
              </h2>
              <div className="flex items-center gap-3 text-[10px]">
                <DataFreshnessBadge
                  freshness={freshness}
                  staleAgeLabel={staleAgeLabel}
                  compact
                />
                <span className="text-slate-500">
                  HRV:{' '}
                  <span className={cn(
                    'tabular-nums font-semibold',
                    dimmed ? 'text-slate-400' : 'text-teal-400'
                  )}>
                    {hrv != null ? `${hrv} ms` : '--'}
                  </span>
                </span>
                <span
                  style={{ color: zoneAccent }}
                  className="font-semibold uppercase tracking-wider"
                >
                  {zone.label}
                </span>
                <span className={cn(
                  'tabular-nums font-light',
                  dimmed ? 'text-slate-400' : 'text-white'
                )}>
                  {freshness === 'NO_DATA' ? '--' : hr}
                  <span className="text-slate-500 ml-1">bpm</span>
                </span>
              </div>
            </div>
            <EcgPaperControls compact />
          </div>
          <div
            className={cn(
              'rounded-xl border border-white/5 overflow-hidden bg-[#0a0a0f] flex-shrink-0 transition-opacity duration-300',
              dimmed && 'opacity-50'
            )}
            style={channelsCanvasHeight != null ? { height: channelsCanvasHeight } : undefined}
          >
            <MultiChannelWaveformCanvas
              waveforms={waveforms}
              channels={DESKTOP_WAVEFORM_CHANNELS}
              fill={ecgGridEnabled}
              height={channelsCanvasHeight ?? 420}
              minHeight={channelsCanvasHeight ?? 420}
              paperGrid={paperGrid}
              paperSpeed={ecgPaperSpeed}
              gain={ecgGain}
              frozen={!isLiveData}
            />
          </div>
        </section>

        {/* Training session — Start Session in the top bar; SUMMARY after End */}
        <section className="relative z-0 flex-shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            Training Session
          </h2>

          {showSummary ? (
            <div className="rounded-lg border border-white/10 bg-gradient-to-br from-slate-900/90 to-slate-950 px-4 py-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className={cn('text-[11px] font-bold uppercase tracking-wider', sessionStatusColor)}>
                  {sessionStatusLabel}
                </span>
                <button
                  type="button"
                  onClick={() => resetFitnessSessionToIdle()}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 transition-colors"
                >
                  New Session
                </button>
              </div>

              {fitnessSessionSummary == null || fitnessSessionSummary.status === 'calculating' ? (
                <p className="text-sm text-slate-400 animate-pulse">
                  Calculating session summary…
                </p>
              ) : fitnessSessionSummary.status === 'too_short' ? (
                <div className="space-y-2">
                  <p className="text-sm text-slate-300">
                    Session too short to generate stats
                  </p>
                  <p className="text-[11px] text-slate-500">
                    Duration{' '}
                    <span className="tabular-nums text-slate-300">
                      {formatSessionClock(fitnessSessionSummary.durationSec)}
                    </span>
                    {' '}· need at least one HR sample (~10s LIVE)
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Duration</p>
                    <p className="text-2xl font-light tabular-nums text-white tracking-tight">
                      {formatSessionClock(fitnessSessionSummary.durationSec)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Avg HR</p>
                    <p className="text-2xl font-light tabular-nums text-white tracking-tight">
                      {fitnessSessionSummary.avgHr}
                      <span className="text-sm text-slate-500 ml-1">bpm</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Max HR</p>
                    <p className="text-2xl font-light tabular-nums text-white tracking-tight">
                      {fitnessSessionSummary.maxHr}
                      <span className="text-sm text-slate-500 ml-1">bpm</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Dominant zone</p>
                    <p
                      className="text-lg font-semibold uppercase tracking-wider"
                      style={{ color: zoneColorForLabel(fitnessSessionSummary.dominantZone) }}
                    >
                      {fitnessSessionSummary.dominantZone}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-950/60 rounded-lg border border-white/5 px-4 py-3">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-baseline gap-3 min-w-0">
                  <span className="text-3xl font-light tabular-nums text-white tracking-tight">
                    {formatSessionClock(elapsed)}
                  </span>
                  <span className={cn('text-[11px] font-bold uppercase tracking-wider', sessionStatusColor)}>
                    {sessionStatusLabel}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[11px] text-slate-500">
                  <span>
                    Zone{' '}
                    <span
                      className="font-semibold uppercase tracking-wider"
                      style={{ color: isLiveData ? zone.color : '#64748b' }}
                    >
                      {isLiveData && zone.label !== '—' ? zone.label : '—'}
                    </span>
                  </span>
                  <span>
                    HR{' '}
                    <span className={cn('tabular-nums font-medium', isLiveData ? 'text-white' : 'text-slate-500')}>
                      {isLiveData && freshness !== 'NO_DATA' ? `${hr} bpm` : '—'}
                    </span>
                  </span>
                </div>
              </div>
              {fitnessSessionStatus === 'idle' && (
                <p className="mt-2 text-[10px] text-slate-600">
                  Press Start Session in the top bar to begin timing your workout.
                </p>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Waveform history scrubber */}
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
              className="timeline-scrubber w-full"
            />
            <div className="flex items-center justify-between text-[10px] text-slate-500">
              <span>Waveform Scrubber</span>
              <span className="tabular-nums">{formatSessionClock(elapsed)} session</span>
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
            Live
          </button>
        </div>
      </div>
    </main>
  );
};

export default FitnessCentralArea;
