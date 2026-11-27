import React from 'react';
import useStore from '../store/useStore';
import WaveformCanvas from './WaveformCanvas';
import SweepChart from './SweepChart';
import { cn } from '../utils/cn';
import { ChevronDown } from 'lucide-react';
import { CH_RANGES, LEADS, LEAD_CHANNEL_INDEX } from '../hooks/useWebSocket';
import { useDataFreshness } from '../hooks/useDataFreshness';
import DataFreshnessBadge from './DataFreshnessBadge';
import { resolveWaveformMode, type WaveformDrawMode } from '../lib/appConfig';

// CHANGE: fixed indices for Resp/PPG, matching useWebSocket.ts's 11-slot
// layout (0-7 ECG leads, 8 Resp, 9 PPG, 10 Temp-reserved). Named constants
// instead of magic numbers so this file doesn't silently drift out of sync
// with the hook again.
const RESP_WAVEFORM_INDEX = 8;
const PPG_WAVEFORM_INDEX = 9;

interface WaveformContainerProps {
  /** Scrubbed waveform windows from the parent useWebSocket() instance. */
  waveforms: number[][];
  /**
   * `sweep` draws the hospital cursor. `scroll` keeps the current strip.
   * Omit to follow VITE_ENABLE_SWEEP_GRAPH (off by default).
   * Scrubbing history always uses scroll — the sweep ring is live-edge only.
   */
  mode?: WaveformDrawMode;
}

/**
 * WaveformContainer Component.
 * Contains and coordinates multiple biological waveform display panels (ECG leads, Respiration, SpO2).
 * Operates in either Normal (single lead overlay) or Advanced (multi-lead array + Resp + SpO2 tracking grids) view modes.
 */
const WaveformContainer: React.FC<WaveformContainerProps> = ({ waveforms, mode }) => {
  const viewMode = useStore(state => state.viewMode);
  const historyOffset = useStore(state => state.historyOffset);
  const selectedLeadIndex = useStore(state => state.selectedLeadIndex);
  const setSelectedLeadIndex = useStore(state => state.setSelectedLeadIndex);
  const isEcgExpanded = useStore(state => state.isEcgExpanded);
  const setIsEcgExpanded = useStore(state => state.setIsEcgExpanded);
  const advancedEcgMode = useStore(state => state.advancedEcgMode);
  const setAdvancedEcgMode = useStore(state => state.setAdvancedEcgMode);
  const { isLiveData, dimmed, freshness, staleAgeLabel } = useDataFreshness();
  const frozen = !isLiveData;
  const liveColor = '#2dd4bf';
  const liveRespColor = '#5eead4';
  const sweepLive = resolveWaveformMode(mode) === 'sweep' && historyOffset === 0;

  const renderWave = (
    channel: number,
    heightPx: number,
    color: string,
    lineWidth: number,
    gridLines: boolean,
    fill = false,
  ) => sweepLive ? (
    <SweepChart
      channel={channel}
      height={heightPx}
      color={color}
      min={CH_RANGES[channel][0]}
      max={CH_RANGES[channel][1]}
      lineWidth={lineWidth}
      grid={gridLines}
      frozen={frozen}
      fill={fill}
    />
  ) : (
    <WaveformCanvas
      data={waveforms[channel]}
      height={heightPx}
      color={color}
      min={CH_RANGES[channel][0]}
      max={CH_RANGES[channel][1]}
      lineWidth={lineWidth}
      gridLines={gridLines}
      frozen={frozen}
      fill={fill}
    />
  );

  // CHANGE: `leads` now comes from the shared LEADS export (no 'Lead III',
  // matches useWebSocket.ts exactly) instead of a locally hardcoded array.
  const leads = LEADS;

  // CHANGE: resolves a lead's display name to its real waveform slot via
  // LEAD_CHANNEL_INDEX, instead of indexing `waveforms` positionally by
  // dropdown index (which breaks the moment the two arrays' orders diverge —
  // exactly what happened here).
  const waveformIndexForLead = (leadIndex: number): number => {
    const name = leads[leadIndex];
    return LEAD_CHANNEL_INDEX[name] ?? 0;
  };

  if (viewMode === 'Normal') {
    const wIdx = waveformIndexForLead(selectedLeadIndex);
    return (
      <div className="flex flex-col bg-transparent">
        <div className="flex items-center justify-between mb-2 px-4 pt-1 flex-shrink-0">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-white">ECG Monitoring</span>
            <div className="relative group">
              <select
                value={selectedLeadIndex}
                onChange={(e) => setSelectedLeadIndex(Number(e.target.value))}
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
              >
                {leads.map((lead, i) => (
                  <option key={lead} value={i} className="bg-slate-900 text-white">{lead}</option>
                ))}
              </select>
              <span className="text-sm font-medium text-slate-300 group-hover:text-white transition-colors flex items-center gap-1">
                {leads[selectedLeadIndex]}
                <ChevronDown size={14} className="opacity-40" />
              </span>
            </div>
            <DataFreshnessBadge
              freshness={freshness}
              staleAgeLabel={staleAgeLabel}
              compact
            />
          </div>
          <button
            onClick={() => setIsEcgExpanded(!isEcgExpanded)}
            className="text-[11px] font-bold text-slate-500 uppercase tracking-widest hover:text-white transition-colors"
          >
            {isEcgExpanded ? '< Collapse' : 'Expand >'}
          </button>
        </div>
        <div className="px-4 pb-1">
          <div className={cn(
            "relative bg-slate-950/40 rounded-xl overflow-hidden border border-white/5 shadow-2xl transition-all duration-300",
            dimmed && "opacity-50",
            isEcgExpanded ? "h-[500px]" : "h-24"
          )}>
            <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
              style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '15px 15px' }}
            />
            {renderWave(wIdx, isEcgExpanded ? 500 : 96, liveColor, isEcgExpanded ? 2.5 : 1.5, isEcgExpanded)}
          </div>
        </div>
      </div>
    );
  }

  const singleLeadWIdx = waveformIndexForLead(selectedLeadIndex);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden gap-1 bg-black">
      <div className="flex items-center justify-between px-2 pt-0.5 flex-shrink-0">
        <div className="flex items-center gap-4 text-[9px] font-bold uppercase tracking-[0.2em]">
          <button
            onClick={() => setAdvancedEcgMode('Single')}
            className={cn("transition-colors", advancedEcgMode === 'Single' ? "text-white border-b border-white pb-0.5" : "text-slate-500")}
          >
            SINGLE LEAD
          </button>
          <button
            onClick={() => setAdvancedEcgMode('All')}
            className={cn("transition-colors", advancedEcgMode === 'All' ? "text-white border-b border-white pb-0.5" : "text-slate-500")}
          >
            ALL LEADS
          </button>
          <DataFreshnessBadge
            freshness={freshness}
            staleAgeLabel={staleAgeLabel}
            compact
          />
        </div>
        {advancedEcgMode === 'Single' && (
          <div className="relative group ml-auto">
            <select
              value={selectedLeadIndex}
              onChange={(e) => setSelectedLeadIndex(Number(e.target.value))}
              className="absolute inset-0 opacity-0 cursor-pointer z-10"
            >
              {leads.map((lead, i) => (
                <option key={lead} value={i} className="bg-slate-900 text-white">{lead}</option>
              ))}
            </select>
            <span className="text-[10px] font-bold text-slate-300 group-hover:text-white transition-colors flex items-center gap-1 uppercase tracking-widest">
              {leads[selectedLeadIndex]}
              <ChevronDown size={12} className="opacity-40" />
            </span>
          </div>
        )}
      </div>

      <div className={cn('flex flex-1 min-h-0 flex-col gap-0.5 overflow-hidden px-2 pb-1', dimmed && 'opacity-50')}>
        {advancedEcgMode === 'All' ? (
          leads.map((label, i) => {
            const wIdx = waveformIndexForLead(i);
            return (
              <div key={label} className="relative flex min-h-0 flex-col bg-slate-900/10 rounded-sm border-b border-slate-900/10" style={{ flex: '28 1 0%' }}>
                <div className="absolute left-1 top-0.5 z-10 text-[7px] font-bold text-slate-600 uppercase">{label}</div>
                {renderWave(wIdx, 28, liveColor, 1, false, true)}
              </div>
            );
          })
        ) : (
          <div className="relative flex min-h-0 flex-col bg-slate-950/60 rounded-lg border border-slate-800" style={{ flex: isEcgExpanded ? '300 1 0%' : '144 1 0%' }}>
            <div className="absolute left-2 top-2 z-10 flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-300 uppercase">{leads[selectedLeadIndex]}</span>
            </div>
            <button
              onClick={() => setIsEcgExpanded(!isEcgExpanded)}
              className="absolute right-2 top-2 z-10 text-[9px] font-medium text-slate-500 uppercase tracking-widest hover:text-white transition-colors"
            >
              {isEcgExpanded ? '< COLLAPSE' : 'EXPAND >'}
            </button>
            {renderWave(singleLeadWIdx, isEcgExpanded ? 300 : 144, liveColor, 2, true, true)}
          </div>
        )}

        <div className="relative flex min-h-0 flex-col bg-slate-950/40 rounded border border-white/5" style={{ flex: '32 1 0%' }}>
          <h4 className="absolute left-1 top-0.5 z-10 text-[8px] font-medium text-white uppercase tracking-widest">Resp Tracking</h4>
          {renderWave(RESP_WAVEFORM_INDEX, 32, liveRespColor, 1, false, true)}
        </div>

        <div className="relative flex min-h-0 flex-col bg-slate-950/40 rounded border border-white/5" style={{ flex: '40 1 0%' }}>
          <h4 className="absolute left-1 top-0.5 z-10 text-[8px] font-medium text-white uppercase tracking-widest">SpO2 Tracking</h4>
          {sweepLive ? (
            renderWave(PPG_WAVEFORM_INDEX, 40, '#5eead4', 1.25, false, true)
          ) : (
            <div className="flex h-full min-h-0 items-end gap-[0.5px] px-1 pb-1 overflow-hidden">
              {waveforms[PPG_WAVEFORM_INDEX].slice(-180).map((val, i) => (
                <div
                  key={i}
                  className={cn(
                    'w-[2px] rounded-t-[1px] flex-shrink-0',
                    frozen ? 'bg-slate-500/35' : 'bg-teal-500/20'
                  )}
                  style={{ height: `${Math.max(3, Math.min(100, (val / CH_RANGES[PPG_WAVEFORM_INDEX][1]) * 100))}%` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WaveformContainer;
