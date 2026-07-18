import React from 'react';
import useStore from '../store/useStore';
import WaveformCanvas from './WaveformCanvas';
import { cn } from '../utils/cn';
import { ChevronDown } from 'lucide-react';
import { useWebSocket, CH_RANGES } from '../hooks/useWebSocket';

import CustomDropdown from './ui/CustomDropdown';

/**
 * WaveformContainer Component.
 * Contains and coordinates multiple biological waveform display panels (ECG leads, Respiration, SpO2).
 * Operates in either Normal (single lead overlay) or Advanced (multi-lead array + Resp + SpO2 tracking grids) view modes.
 */
const WaveformContainer: React.FC = () => {
  const viewMode = useStore(state => state.viewMode);
  const selectedLeadIndex = useStore(state => state.selectedLeadIndex);
  const setSelectedLeadIndex = useStore(state => state.setSelectedLeadIndex);
  const isEcgExpanded = useStore(state => state.isEcgExpanded);
  const setIsEcgExpanded = useStore(state => state.setIsEcgExpanded);
  const advancedEcgMode = useStore(state => state.advancedEcgMode);
  const setAdvancedEcgMode = useStore(state => state.setAdvancedEcgMode);

  const { waveforms } = useWebSocket();
  const vitals = useStore(state => state.vitals);



  const leads = ['Lead I', 'Lead II', 'Lead III', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];

  if (viewMode === 'Normal') {
    return (
      <div className="flex flex-col p-4 pt-0 bg-transparent flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
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
          </div>
          <button
            onClick={() => setIsEcgExpanded(!isEcgExpanded)}
            className="text-[11px] font-bold text-slate-500 uppercase tracking-widest hover:text-white transition-colors"
          >
            {isEcgExpanded ? '< Collapse' : 'Expand >'}
          </button>
        </div>
        <div className={cn(
          "relative bg-slate-950/40 rounded-xl overflow-hidden border border-white/5 shadow-2xl transition-all duration-300",
          isEcgExpanded ? "h-[500px]" : "h-24"
        )}>
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '15px 15px' }}
          />
          <WaveformCanvas
            data={waveforms[selectedLeadIndex]}
            height={isEcgExpanded ? 500 : 96}
            color="#2dd4bf"
            min={CH_RANGES[selectedLeadIndex][0]} max={CH_RANGES[selectedLeadIndex][1]}
            lineWidth={isEcgExpanded ? 2.5 : 1.5}
            gridLines={isEcgExpanded}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col p-2 pt-0.5 gap-1 bg-black flex-1 justify-between">
      <div className="flex items-center justify-between px-1">
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

      {/* Multi-lead or Single-lead ECG */}
      <div className="flex flex-col gap-0.5 min-h-0">
        {advancedEcgMode === 'All' ? (
          leads.map((label, i) => (
            <div key={label} className="relative bg-slate-900/10 rounded-sm border-b border-slate-900/10">
              <div className="absolute left-1 top-0.5 z-10 text-[7px] font-bold text-slate-600 uppercase">{label}</div>
              <WaveformCanvas
                data={waveforms[i]}
                height={28}
                color="#2dd4bf"
                min={CH_RANGES[selectedLeadIndex][0]} max={CH_RANGES[selectedLeadIndex][1]}
                gridLines={false}
                lineWidth={1}
              />
            </div>
          ))
        ) : (
          <div className={cn(
            "relative bg-slate-950/60 rounded-lg border border-slate-800 transition-all duration-300",
            isEcgExpanded ? "h-[300px]" : "h-36"
          )}>
            <div className="absolute left-2 top-2 z-10 flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-300 uppercase">{leads[selectedLeadIndex]}</span>
            </div>
            <button
              onClick={() => setIsEcgExpanded(!isEcgExpanded)}
              className="absolute right-2 top-2 z-10 text-[9px] font-medium text-slate-500 uppercase tracking-widest hover:text-white transition-colors"
            >
              {isEcgExpanded ? '< COLLAPSE' : 'EXPAND >'}
            </button>
            <WaveformCanvas
              data={waveforms[selectedLeadIndex]}
              height={isEcgExpanded ? 300 : 144}
              color="#2dd4bf"
              min={CH_RANGES[selectedLeadIndex][0]} max={CH_RANGES[selectedLeadIndex][1]}
              gridLines={true}
              lineWidth={2}
            />
          </div>
        )}
      </div>

      {/* Respiration - Much Narrower */}
      <div className="flex flex-col mt-0.5">
        <div className="flex items-center justify-between px-1 mb-0.5">
          <h4 className="text-[8px] font-medium text-white uppercase tracking-widest">Resp Tracking</h4>
        </div>
        <div className="bg-slate-950/40 rounded border border-white/5 h-8">
          <WaveformCanvas
            data={waveforms[9]}
            height={32}
            color="#5eead4"
            min={CH_RANGES[4][0]} max={CH_RANGES[9][1]}
            gridLines={false}
            lineWidth={1}
          />
        </div>
      </div>

      {/* SpO2 Graph - Refined */}
      <div className="flex flex-col mt-0.5">
        <div className="flex items-center justify-between px-1 mb-0.5">
          <h4 className="text-[8px] font-medium text-white uppercase tracking-widest">SpO2 Tracking</h4>
        </div>
        <div className="flex items-end gap-[0.5px] h-10 px-1 pb-1 overflow-hidden bg-slate-950/40 rounded border border-white/5">
          {waveforms[10].slice(-180).map((val, i) => (
            <div
              key={i}
              className="bg-teal-500/20 w-[2px] rounded-t-[1px] flex-shrink-0"
              style={{ height: `${Math.max(3, Math.min(100, (val / CH_RANGES[10][1]) * 100))}%` }}
            />
          ))}
        </div>
      </div>



    </div>
  );
};

export default WaveformContainer;
