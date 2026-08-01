import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../utils/cn';
import useStore from '../store/useStore';

const RANGE_SECONDS: Record<string, number> = {
  '1 Min': 60,
  '1 Hr': 3600,
  '1 Day': 86400,
};

// ── Clinical event types defined ─────────────────────────────────────────────
const EVENT_TYPE_MAP: Record<string, string[]> = {
  'Tachycardia': ['tachycardia'],
  'Bradycardia': ['bradycardia'],
  'SpO2 Drop': ['spo2_drop'],
  'Hyperthermia': ['hyperthermia'],
  'Hypothermia': ['hypothermia'],
  'Tachypnea': ['tachypnea'],
  'Bradypnea': ['bradypnea'],
  'Hypertension': ['hypertension'],
  'Hypotension': ['hypotension'],
};

const severityColor: Record<string, string> = {
  high: 'border-red-500/30 bg-red-500/10',
  medium: 'border-yellow-500/25 bg-yellow-500/10',
  low: 'border-white/5 bg-slate-900/40',
};

/**
 * AdvancedControls Component.
 * Provides controls for searching, filtering, and traversing historical data,
 * as well as viewing recent clinical alerts.
 */
const AdvancedControls: React.FC = () => {
  const events = useStore(s => s.events);
  const alerts = useStore(s => s.alerts);
  const getEventsInRange = useStore(s => s.getEventsInRange);
  const jumpToEvent = useStore(s => s.jumpToEvent);

  const ranges = ['1 Min', '1 Hr', '1 Day'];
  const [activeRange, setActiveRange] = React.useState<string | null>(null);
  const [filterIndex, setFilterIndex] = React.useState(0);

  const eventsInRange = React.useMemo(() => {
    const rangeS = activeRange ? RANGE_SECONDS[activeRange] : 3600;
    return getEventsInRange(rangeS);
  }, [events, activeRange, getEventsInRange]);

  const dropdownOptions = React.useMemo(() => {
    const opts: { label: string; count: number; index: number }[] = [];
    Object.entries(EVENT_TYPE_MAP).forEach(([label, types], i) => {
      const count = eventsInRange.filter(e => types.includes(e.type)).length;
      if (count > 0) opts.push({ label, count, index: i + 1 });
    });
    return opts;
  }, [eventsInRange]);

  const selectedLabel = filterIndex === 0
    ? 'Select Events'
    : Object.keys(EVENT_TYPE_MAP)[filterIndex - 1];

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5 bg-black">
      {/* Ranges + event filters (timeline scrubber lives in MobileLiveBar) */}
      <div className="flex flex-col gap-1.5 p-1.5 bg-slate-900/30 border border-slate-800/50 rounded-xl">
        <div className="flex gap-1 justify-center">
          {ranges.map(range => (
            <button
              key={range}
              type="button"
              onClick={() => setActiveRange(prev => prev === range ? null : range)}
              className={cn(
                'flex-1 px-1 py-2 rounded-full text-[10px] font-bold uppercase transition-all border min-w-[30px]',
                activeRange === range
                  ? 'bg-teal-500 text-white border-teal-400 shadow-lg shadow-teal-500/20'
                  : 'text-slate-500 border-slate-800 hover:text-slate-300'
              )}
            >
              {range.replace(' Min', 'm').replace(' Hr', 'h').replace(' Day', 'd')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-0.5 justify-center w-full">
          <button
            type="button"
            onClick={() => setFilterIndex(0)}
            className={cn(
              'flex-1 px-1 py-1.5 rounded-full text-[8px] font-bold uppercase transition-all border whitespace-nowrap',
              filterIndex === 0
                ? 'bg-teal-500 text-white border-teal-400 shadow-lg shadow-teal-500/20'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white'
            )}
          >
            All Events
          </button>

          <div className="relative group flex-1 flex justify-center items-center ml-1">
            <select
              value={filterIndex}
              onChange={(e) => {
                const idx = Number(e.target.value);
                setFilterIndex(idx);
                if (idx > 0) {
                  const label = Object.keys(EVENT_TYPE_MAP)[idx - 1];
                  const types = EVENT_TYPE_MAP[label] ?? [];
                  const latest = eventsInRange.find(ev => types.includes(ev.type));
                  if (latest) jumpToEvent(latest);
                }
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            >
              <option value={0} className="bg-slate-900 text-white">
                Select Events {eventsInRange.length > 0 && `(${eventsInRange.length})`}
              </option>
              {dropdownOptions.length === 0 ? (
                <option disabled className="bg-slate-900 text-slate-500">
                  No events yet
                </option>
              ) : (
                dropdownOptions.map(opt => (
                  <option key={opt.label} value={opt.index} className="bg-slate-900 text-white">
                    {opt.label} ({opt.count})
                  </option>
                ))
              )}
            </select>
            <span className={cn(
              'text-[8px] font-bold transition-colors flex items-center gap-0.5 uppercase whitespace-nowrap',
              filterIndex !== 0 ? 'text-teal-400 group-hover:text-teal-300' : 'text-slate-400 group-hover:text-white'
            )}>
              <span className="truncate max-w-[65px]">
                {filterIndex === 0 ? 'Select Events' : selectedLabel}
              </span>
              <ChevronDown size={10} className="opacity-50 flex-shrink-0" />
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col px-1 flex-shrink-0">
        <span className="text-[9px] font-medium text-slate-400 uppercase tracking-[0.2em] mb-1">Recent Alerts</span>
        {/* Fixed height ≈ 2 alert rows; scroll inside for the rest (like Normal's 3) */}
        <div className="flex flex-col gap-1 h-[72px] overflow-y-auto overscroll-contain scrollbar-hide">
          {alerts.length === 0 ? (
            <span className="text-[9px] text-slate-600 italic px-1">No alerts</span>
          ) : (
            alerts.map(alert => (
              <div
                key={alert.id}
                className={cn(
                  'flex items-center gap-3 p-2 rounded border flex-shrink-0',
                  severityColor[alert.severity] ?? severityColor.low
                )}
              >
                <span className="text-[8px] text-slate-500 font-bold uppercase flex-shrink-0">{alert.timestamp}</span>
                <span className="text-[10px] font-medium text-white truncate">{alert.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AdvancedControls;
