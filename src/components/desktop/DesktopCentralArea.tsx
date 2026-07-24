import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import useStore from '../../store/useStore';
import EcgPaperControls from './EcgPaperControls';
import MultiChannelWaveformCanvas from './MultiChannelWaveformCanvas';
import { DESKTOP_WAVEFORM_CHANNELS } from './desktopWaveformChannels';
import { cn } from '../../utils/cn';

const MAX_HISTORY_SECONDS = 3600;

interface DesktopCentralAreaProps {
  waveforms: number[][];
}

/**
 * DesktopCentralArea — compact single-canvas multi-channel monitor + scrubber.
 */
const DesktopCentralArea: React.FC<DesktopCentralAreaProps> = ({ waveforms }) => {
  const historyOffset = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);
  const vitals = useStore(s => s.vitals);
  const activity = useStore(s => s.activity);
  const ecgGridEnabled = useStore(s => s.ecgGridEnabled);
  const ecgPaperSpeed = useStore(s => s.ecgPaperSpeed);
  const ecgGain = useStore(s => s.ecgGain);

  const paperGrid = ecgGridEnabled ? 'clinical' : 'off';
  const isLive = historyOffset === 0;

  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  const timeRange = React.useMemo(() => {
    const end = new Date(isLive ? now : Date.now() - historyOffset * 1000);
    const start = new Date(end.getTime() - 105 * 60 * 1000);
    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${fmt(start)} — ${fmt(end)}`;
  }, [isLive, now, historyOffset]);

  const handleSeek = (direction: 'back' | 'forward', amount: number) => {
    const next = direction === 'back'
      ? Math.min(historyOffset + amount, MAX_HISTORY_SECONDS)
      : Math.max(0, historyOffset - amount);
    setHistoryOffset(next);
  };

  const tempDisplay = typeof vitals.temperature.value === 'number'
    ? `${vitals.temperature.value}°C`
    : '--';

  return (
    <main className="flex-1 min-w-0 flex flex-col bg-black overflow-hidden">
      <div className={cn(
        'flex-1 min-h-0 px-4 py-3 flex flex-col gap-3',
        ecgGridEnabled ? 'overflow-y-auto scrollbar-hide' : 'overflow-hidden'
      )}>
        <section className={cn('flex flex-col', ecgGridEnabled ? 'flex-shrink-0' : 'flex-1 min-h-0')}>
          <div className="flex items-center justify-between gap-3 mb-2 flex-wrap flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
                All Channels
              </h2>
              <span className="text-[10px] text-slate-600">
                8 ECG · Resp · SpO2 — single canvas
              </span>
            </div>
            <EcgPaperControls />
          </div>

          <div className={cn(
            'rounded-xl border border-white/5 overflow-hidden',
            ecgGridEnabled ? 'flex-shrink-0' : 'flex-1 min-h-[320px]'
          )}>
            <MultiChannelWaveformCanvas
              waveforms={waveforms}
              channels={DESKTOP_WAVEFORM_CHANNELS}
              fill
              minHeight={320}
              paperGrid={paperGrid}
              paperSpeed={ecgPaperSpeed}
              gain={ecgGain}
            />
          </div>

          {/* Non-waveform sensors — numeric only until hardware sends traces */}
          <div className="mt-2 flex-shrink-0 grid grid-cols-3 gap-2 text-[10px]">
            <div className="px-2 py-1.5 rounded-lg border border-slate-800/80 bg-slate-950/40 text-slate-500">
              BP Trend <span className="text-slate-600">— pending</span>
            </div>
            <div className="px-2 py-1.5 rounded-lg border border-slate-800/80 bg-slate-950/40 text-slate-500">
              Temp <span className="text-slate-300 tabular-nums">{tempDisplay}</span>
            </div>
            <div className="px-2 py-1.5 rounded-lg border border-slate-800/80 bg-slate-950/40 text-slate-500">
              Activity <span className="text-slate-300">{activity.activityType} · {activity.steps.toLocaleString()} steps</span>
            </div>
          </div>
        </section>
      </div>

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
              <span>Timeline Scrubber</span>
              <span className="tabular-nums">{timeRange}</span>
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

export default DesktopCentralArea;
