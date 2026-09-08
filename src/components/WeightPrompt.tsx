import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import useStore from '../store/useStore';
import { persistBodyWeightKg } from '../lib/userWeight';
import { estimateCalories } from '../utils/fitnessMetrics';
import { useCalorieElapsedSec } from '../hooks/useCalorieElapsed';
import { cn } from '../utils/cn';

interface WeightPromptProps {
  layout: 'bar' | 'stat';
}

/**
 * Calories estimate that requires a saved body weight.
 * No weight → "Enter your weight". With weight → number + edit.
 */
const WeightPrompt: React.FC<WeightPromptProps> = ({ layout }) => {
  const bodyWeightKg = useStore(s => s.bodyWeightKg);
  const heartRate = useStore(s => s.vitals.heartRate.value);
  const steps = useStore(s => s.activity.steps);
  const elapsed = useCalorieElapsedSec();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const calories = estimateCalories(elapsed, heartRate, steps, bodyWeightKg);
  const [sheetTop, setSheetTop] = useState(24);

  // Pin the dialog to the visible viewport so the mobile shell (overflow hidden)
  // and the keyboard don't clip it at the bottom.
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const vv = window.visualViewport;
      const top = vv ? vv.offsetTop + 16 : 24;
      setSheetTop(Math.max(16, Math.round(top)));
    };
    place();
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [open]);

  const openEditor = () => {
    setDraft(bodyWeightKg != null ? String(bodyWeightKg) : '');
    setError(null);
    setOpen(true);
  };

  const save = async () => {
    const kg = Number(draft);
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
      setError('Enter a weight between 20 and 400 kg.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await persistBodyWeightKg(Math.round(kg * 10) / 10);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save weight.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {layout === 'bar' ? (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {bodyWeightKg == null || calories == null ? (
            <button
              type="button"
              onClick={openEditor}
              className="text-teal-400 hover:text-teal-300 transition-colors"
            >
              Enter your weight
            </button>
          ) : (
            <>
              <span>Calories Est: ~{calories.toLocaleString()}</span>
              <button
                type="button"
                onClick={openEditor}
                className="inline-flex items-center text-slate-500 hover:text-teal-300 transition-colors"
                title="Edit weight"
                aria-label="Edit weight"
              >
                <Pencil size={10} />
              </button>
            </>
          )}
        </span>
      ) : (
        <div className="flex flex-col items-center border-r border-slate-900 min-w-0 px-1">
          {bodyWeightKg == null || calories == null ? (
            <button
              type="button"
              onClick={openEditor}
              className="text-[11px] font-semibold text-teal-400 hover:text-teal-300 leading-tight text-center"
            >
              Enter your weight
            </button>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="text-2xl font-medium text-white tabular-nums">
                {calories.toLocaleString()}
              </span>
              <button
                type="button"
                onClick={openEditor}
                className="text-slate-500 hover:text-teal-300 transition-colors"
                title="Edit weight"
                aria-label="Edit weight"
              >
                <Pencil size={12} />
              </button>
            </span>
          )}
          <span className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">
            Calories
          </span>
        </div>
      )}

      {open &&
        createPortal(
        <div className="fixed inset-0 z-[200] bg-black/60">
          <div
            className="absolute left-4 right-4 mx-auto w-full max-w-xs rounded-xl border border-slate-800 bg-slate-950 p-4 shadow-xl"
            style={{ top: sheetTop }}
          >
            <p className="text-sm font-medium text-white">
              {bodyWeightKg == null ? 'Enter your weight' : 'Edit weight'}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Used only to estimate calories. Not stored as a default.
            </p>
            <label className="mt-3 block text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Weight (kg)
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={20}
              max={400}
              step={0.1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => {
                // 16px keeps iOS from zooming the page when the field focuses.
                e.currentTarget.style.fontSize = '16px';
              }}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-base text-white focus:outline-none focus:border-teal-500"
              style={{ fontSize: 16 }}
            />
            {error && <p className="mt-2 text-[11px] text-rose-400">{error}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className={cn(
                  'rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400 disabled:opacity-50'
                )}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>,
        document.body
        )}
    </>
  );
};

export default WeightPrompt;
