import React from 'react';
import { Grid3x3, Ruler } from 'lucide-react';
import useStore from '../../store/useStore';
import { cn } from '../../utils/cn';
import type { EcgGainSetting, EcgPaperSpeedSetting } from '../../types';

const SPEEDS: EcgPaperSpeedSetting[] = [25, 50];
const GAINS: EcgGainSetting[] = [5, 10, 20];

/**
 * Compact toolbar for digital ECG paper: grid, speed, gain, measure.
 */
const EcgPaperControls: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const ecgGridEnabled = useStore(s => s.ecgGridEnabled);
  const setEcgGridEnabled = useStore(s => s.setEcgGridEnabled);
  const ecgPaperSpeed = useStore(s => s.ecgPaperSpeed);
  const setEcgPaperSpeed = useStore(s => s.setEcgPaperSpeed);
  const ecgGain = useStore(s => s.ecgGain);
  const setEcgGain = useStore(s => s.setEcgGain);
  const ecgMeasureEnabled = useStore(s => s.ecgMeasureEnabled);
  const setEcgMeasureEnabled = useStore(s => s.setEcgMeasureEnabled);

  return (
    <div className={cn('flex items-center gap-2 flex-wrap', compact && 'gap-1.5')}>
      <button
        type="button"
        onClick={() => setEcgGridEnabled(!ecgGridEnabled)}
        title={ecgGridEnabled ? 'ECG paper grid: ON' : 'ECG paper grid: OFF'}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors',
          ecgGridEnabled
            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
            : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-slate-300'
        )}
      >
        <Grid3x3 size={11} />
        Grid
      </button>

      <div className="flex items-center rounded border border-slate-800 bg-slate-900/60 p-0.5">
        {SPEEDS.map((speed) => (
          <button
            key={speed}
            type="button"
            onClick={() => setEcgPaperSpeed(speed)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums transition-colors',
              ecgPaperSpeed === speed
                ? 'bg-teal-500/20 text-teal-300'
                : 'text-slate-500 hover:text-slate-300'
            )}
            title={`Paper speed ${speed} mm/s`}
          >
            {speed}
          </button>
        ))}
        <span className="px-1 text-[8px] text-slate-600">mm/s</span>
      </div>

      <div className="flex items-center rounded border border-slate-800 bg-slate-900/60 p-0.5">
        {GAINS.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => setEcgGain(g)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[9px] font-bold tabular-nums transition-colors',
              ecgGain === g
                ? 'bg-teal-500/20 text-teal-300'
                : 'text-slate-500 hover:text-slate-300'
            )}
            title={`Gain ${g} mm/mV`}
          >
            {g}
          </button>
        ))}
        <span className="px-1 text-[8px] text-slate-600">mm/mV</span>
      </div>

      <button
        type="button"
        onClick={() => setEcgMeasureEnabled(!ecgMeasureEnabled)}
        title={ecgMeasureEnabled ? 'Measure tool: ON — drag on strip' : 'Measure tool: OFF'}
        className={cn(
          'flex items-center gap-1 px-2 py-1 rounded border text-[9px] font-bold uppercase tracking-wider transition-colors',
          ecgMeasureEnabled
            ? 'bg-teal-500/20 border-teal-500/40 text-teal-300'
            : 'bg-slate-900/60 border-slate-800 text-slate-500 hover:text-slate-300'
        )}
      >
        <Ruler size={11} />
        Measure
      </button>
    </div>
  );
};

export default EcgPaperControls;
