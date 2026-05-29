import React from 'react';
import { Play } from 'lucide-react';
import WaveformCanvas from './WaveformCanvas';

/**
 * Properties for the AuscultationPanel component.
 */
interface AuscultationPanelProps {
  /** Array of auscultation audio waveform samples. */
  waveform: number[];
}

/**
 * AuscultationPanel Component.
 * Visualizes the real-time auscultation audio waveform signal.
 */
const AuscultationPanel: React.FC<AuscultationPanelProps> = ({ waveform }) => {
  return (
    <div className="flex flex-col w-full p-6 bg-slate-950/40 border-t border-slate-900 pb-28">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Auscultation</h3>
        <button className="flex items-center gap-2 px-3 py-1 bg-slate-800/50 hover:bg-slate-700/50 text-[10px] font-bold text-slate-300 rounded-md transition-all uppercase tracking-widest border border-slate-700">
          <Play size={12} fill="currentColor" />
          Start listening
        </button>
      </div>

      <div className="rounded-xl overflow-hidden border border-slate-900 bg-black/40">
        <WaveformCanvas
          data={waveform}
          height={60}
          color="#38bdf8"
          lineWidth={1}
          min={-0.2}
          max={0.2}
          gridLines={false}
        />
      </div>

      <div className="mt-4 flex justify-between items-center text-[10px] text-slate-500 font-mono">
        <span>Battery: 80%</span>
        <span>Connection: Stable</span>
        <span className="text-emerald-500 uppercase">User Name • Device Connected</span>
      </div>
    </div>
  );
};

export default AuscultationPanel;
