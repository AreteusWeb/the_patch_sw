import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import useStore from '../../store/useStore';
import WaveformCanvas from '../WaveformCanvas';
import { CH_RANGES, LEADS, LEAD_CHANNEL_INDEX } from '../../hooks/useWebSocket';
import { cn } from '../../utils/cn';

const MAX_HISTORY_SECONDS = 3600;
// Matches useWebSocket.ts: 0-7 ECG, 8 Resp, 9 PPG (no Lead III).
const RESP_WAVEFORM_INDEX = 8;
const PPG_WAVEFORM_INDEX = 9;
// Featured panels: Lead II + V2 (clinical + precordial).
const FEATURED_LEAD_INDICES = [
  LEAD_CHANNEL_INDEX['Lead II'],
  LEAD_CHANNEL_INDEX['V2'],
] as const;

const PlaceholderTrend: React.FC<{ label: string; value?: string; color?: string }> = ({
  label,
  value,
  color = '#64748b',
}) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">{label}</span>
      {value && <span className="text-[10px] text-slate-500 tabular-nums">{value}</span>}
    </div>
    <div className="h-8 bg-slate-950/60 rounded border border-white/5 flex items-center px-2 overflow-hidden">
      <svg className="w-full h-4" viewBox="0 0 200 16" preserveAspectRatio="none">
        <path
          d="M0,8 Q20,4 40,8 T80,8 T120,6 T160,10 T200,8"
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          opacity="0.6"
        />
      </svg>
    </div>
  </div>
);

/**
 * DesktopCentralArea
 * Panel central dominante: 12-lead ECG, waveforms apilados y timeline scrubber.
 */
interface DesktopCentralAreaProps {
  waveforms: number[][];
}

const DesktopCentralArea: React.FC<DesktopCentralAreaProps> = ({ waveforms }) => {
  const historyOffset = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);
  const vitals = useStore(s => s.vitals);
  const activity = useStore(s => s.activity);

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
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 py-3 flex flex-col gap-3">
        {/* 12-Lead ECG — primary panel */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              12-Lead ECG
            </h2>
            <span className="text-[10px] text-slate-600">Primary Monitor</span>
          </div>

          <div className="bg-slate-950/50 rounded-xl border border-white/5 overflow-hidden">
            {/* Featured leads — larger */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-slate-800/30">
              {FEATURED_LEAD_INDICES.map((leadIdx) => (
                <div key={LEADS[leadIdx]} className="relative bg-slate-950/80 h-36">
                  <span className="absolute left-2 top-2 z-10 text-[10px] font-bold text-teal-500/80 uppercase">
                    {LEADS[leadIdx]}
                  </span>
                  <WaveformCanvas
                    data={waveforms[leadIdx]}
                    height={144}
                    color="#2dd4bf"
                    min={CH_RANGES[leadIdx][0]}
                    max={CH_RANGES[leadIdx][1]}
                    gridLines
                    lineWidth={2}
                  />
                </div>
              ))}
            </div>

            {/* Remaining leads — compact stack */}
            <div className="flex flex-col gap-px bg-slate-800/20">
              {LEADS.map((label, i) => {
                if (FEATURED_LEAD_INDICES.includes(i as (typeof FEATURED_LEAD_INDICES)[number])) return null;
                return (
                  <div key={label} className="relative bg-slate-950/60 h-7">
                    <span className="absolute left-2 top-0.5 z-10 text-[7px] font-bold text-slate-600 uppercase">
                      {label}
                    </span>
                    <WaveformCanvas
                      data={waveforms[i]}
                      height={28}
                      color="#2dd4bf"
                      min={CH_RANGES[i][0]}
                      max={CH_RANGES[i][1]}
                      gridLines={false}
                      lineWidth={1}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Multi-parameter waveforms */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400 mb-2">
            Multi-Parameter Waveforms
          </h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                Respiration
              </span>
              <div className="h-10 bg-slate-950/60 rounded border border-white/5">
                <WaveformCanvas
                  data={waveforms[RESP_WAVEFORM_INDEX]}
                  height={40}
                  color="#5eead4"
                  min={CH_RANGES[RESP_WAVEFORM_INDEX][0]}
                  max={CH_RANGES[RESP_WAVEFORM_INDEX][1]}
                  gridLines={false}
                  lineWidth={1.2}
                />
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">
                SpO2 Pleth
              </span>
              <div className="flex items-end gap-[1px] h-10 px-1 pb-1 overflow-hidden bg-slate-950/60 rounded border border-white/5">
                {waveforms[PPG_WAVEFORM_INDEX].slice(-240).map((val, i) => (
                  <div
                    key={i}
                    className="bg-teal-500/30 w-[2px] rounded-t-[1px] flex-shrink-0"
                    style={{
                      height: `${Math.max(4, Math.min(100, (val / CH_RANGES[PPG_WAVEFORM_INDEX][1]) * 100))}%`,
                    }}
                  />
                ))}
              </div>
            </div>

            <PlaceholderTrend label="BP Trend" color="#94a3b8" />
            <PlaceholderTrend label="Temp" value={tempDisplay} color="#f97316" />
          </div>

          <div className="mt-3">
            <PlaceholderTrend
              label="Activity"
              value={`${activity.activityType} • ${activity.steps.toLocaleString()} steps`}
              color="#a78bfa"
            />
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
