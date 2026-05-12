import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, Check } from 'lucide-react';
import { cn } from '../utils/cn';
import useStore from '../store/useStore';

const MAX_HISTORY_SECONDS = 3600;

const RANGE_SECONDS: Record<string, number> = {
  '1 Min': 60,
  '1 Hr': 3600,
  '1 Day': 86400,
};

// ── Tipos de evento clínicos definidos ───────────────────────────────────────
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

const AdvancedControls: React.FC = () => {
  const historyOffset = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);
  const events = useStore(s => s.events);
  const alerts = useStore(s => s.alerts);
  const getEventsInRange = useStore(s => s.getEventsInRange);
  const jumpToEvent = useStore(s => s.jumpToEvent);

  const ranges = ['1 Min', '1 Hr', '1 Day'];
  const [activeRange, setActiveRange] = React.useState<string | null>(null);
  const [filterIndex, setFilterIndex] = React.useState(0);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const isLive = historyOffset === 0;

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const displayTime = React.useMemo(() => {
    const target = new Date(Date.now() - historyOffset * 1000);
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    const hh = String(target.getHours()).padStart(2, '0');
    const min = String(target.getMinutes()).padStart(2, '0');
    const ss = String(target.getSeconds()).padStart(2, '0');
    return { date: `${mm}/${dd}`, time: `${hh}:${min}:${ss}` };
  }, [historyOffset]);

  const eventsInRange = React.useMemo(() => {
    const rangeS = activeRange ? RANGE_SECONDS[activeRange] : 3600;
    return getEventsInRange(rangeS);
  }, [events, activeRange, getEventsInRange]);

  const filteredEvents = React.useMemo(() => {
    if (filterIndex === 0) return eventsInRange;
    const typeLabel = Object.keys(EVENT_TYPE_MAP)[filterIndex - 1];
    const allowed = EVENT_TYPE_MAP[typeLabel] ?? [];
    return eventsInRange.filter(e => allowed.includes(e.type));
  }, [eventsInRange, filterIndex]);

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

  const navigateEvent = (direction: 'prev' | 'next') => {
    if (filteredEvents.length === 0) return;
    const currentEpoch = Date.now() - historyOffset * 1000;
    if (direction === 'prev') {
      const prev = filteredEvents.find(e => e.timestampEpoch < currentEpoch - 2000);
      if (prev) jumpToEvent(prev);
    } else {
      const next = [...filteredEvents].reverse().find(e => e.timestampEpoch > currentEpoch + 2000);
      if (next) jumpToEvent(next);
      else setHistoryOffset(0);
    }
  };

  const handleSeek = (direction: 'back' | 'forward', amount: number) => {
    const next = direction === 'back'
      ? Math.min(historyOffset + amount, MAX_HISTORY_SECONDS)
      : Math.max(0, historyOffset - amount);
    setHistoryOffset(next);
  };

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5 bg-black">
      <div className="flex flex-col gap-1 mt-0.5">
        <div className="flex items-center justify-between gap-2">

          {/* Izquierda: «← + Past Status */}
          <div className="flex flex-col items-center gap-1.5 min-w-[75px]">
            <div className="flex gap-1">
              <button onClick={() => handleSeek('back', 60)} title="1 Min atrás"
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors">
                <ChevronsLeft size={16} className="text-slate-400" />
              </button>
              <button onClick={() => handleSeek('back', 10)} title="10s atrás"
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors">
                <ChevronLeft size={16} className="text-slate-400" />
              </button>
            </div>
            <div className={cn(
              "w-full px-1.5 py-2 rounded border text-[8px] font-bold uppercase tracking-[0.05em] text-center transition-all duration-300 whitespace-nowrap",
              !isLive
                ? "bg-teal-500 text-white shadow-lg shadow-teal-500/20 border-teal-400"
                : "border-slate-800 text-slate-700"
            )}>
              Past Status
            </div>
          </div>

          {/* Centro: rangos + dropdown eventos */}
          <div className="flex-1 flex flex-col gap-1.5 p-1.5 bg-slate-900/30 border border-slate-800/50 rounded-xl min-w-[120px]">
            <div className="flex gap-1 justify-center">
              {ranges.map(range => (
                <button key={range}
                  onClick={() => setActiveRange(prev => prev === range ? null : range)}
                  className={cn(
                    "flex-1 px-1 py-2 rounded-full text-[10px] font-bold uppercase transition-all border min-w-[30px]",
                    activeRange === range
                      ? "bg-teal-500 text-white border-teal-400 shadow-lg shadow-teal-500/20"
                      : "text-slate-500 border-slate-800 hover:text-slate-300"
                  )}>
                  {range.replace(' Min', 'm').replace(' Hr', 'h').replace(' Day', 'd')}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 justify-center w-full mt-1">
              <button
                type="button"
                onClick={() => setFilterIndex(0)}
                className={cn(
                  "flex-1 px-2 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all border whitespace-nowrap",
                  filterIndex === 0
                    ? "bg-teal-500 text-white border-teal-400 shadow-lg shadow-teal-500/20"
                    : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white"
                )}
              >
                All Events
              </button>

              <div className="relative z-50 flex-1" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setDropdownOpen(o => !o)}
                  className={cn(
                    "w-full flex items-center justify-between gap-1 px-3 py-1.5 rounded-full text-[9px] font-bold uppercase tracking-widest transition-all border whitespace-nowrap",
                    filterIndex !== 0
                      ? "bg-teal-500 text-white border-teal-400 shadow-lg shadow-teal-500/20"
                      : "bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-white"
                  )}
                >
                  <span className="truncate">
                    {filterIndex === 0 ? 'Select Events' : selectedLabel}
                  </span>
                  <ChevronDown size={12} className={cn("transition-transform duration-200 flex-shrink-0 opacity-70", dropdownOpen && "rotate-180")} />
                </button>

                {dropdownOpen && (
                  <div className="absolute z-[100] bottom-full mb-1 left-1/2 -translate-x-1/2 min-w-[160px] bg-slate-900 border border-slate-700 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                    <div className="max-h-[200px] overflow-y-auto">
                      <button
                        type="button"
                        onClick={() => { setFilterIndex(0); setDropdownOpen(false); }}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-left transition-colors border-b border-white/5",
                          filterIndex === 0
                            ? "bg-teal-500 text-white"
                            : "text-slate-400 hover:bg-slate-800 hover:text-white"
                        )}
                      >
                        <span>All Events {eventsInRange.length > 0 && `(${eventsInRange.length})`}</span>
                        {filterIndex === 0 && <Check size={12} className="text-white" />}
                      </button>

                      {dropdownOptions.length === 0 ? (
                        <div className="px-4 py-3 text-[9px] text-slate-600 uppercase tracking-widest">
                          No events yet
                        </div>
                      ) : (
                        dropdownOptions.map(opt => (
                          <button
                            key={opt.label}
                            type="button"
                            onClick={() => {
                              setFilterIndex(opt.index);
                              setDropdownOpen(false);
                              const types = EVENT_TYPE_MAP[opt.label] ?? [];
                              const latest = eventsInRange.find(e => types.includes(e.type));
                              if (latest) jumpToEvent(latest);
                            }}
                            className={cn(
                              "w-full flex items-center justify-between px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-left transition-colors border-b border-white/5 last:border-0",
                              filterIndex === opt.index
                                ? "bg-teal-500 text-white"
                                : "text-slate-400 hover:bg-slate-800 hover:text-white"
                            )}
                          >
                            <span>{opt.label}</span>
                            <span className={cn("text-[8px]", filterIndex === opt.index ? "text-white/70" : "text-slate-600")}>
                              {opt.count}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Derecha: →» + Live */}
          <div className="flex flex-col items-center gap-1.5 min-w-[75px]">
            <div className="flex gap-1">
              <button onClick={() => handleSeek('forward', 10)} title="10s adelante"
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors">
                <ChevronRight size={16} className="text-slate-400" />
              </button>
              <button onClick={() => handleSeek('forward', 60)} title="1 Min adelante"
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors">
                <ChevronsRight size={16} className="text-slate-400" />
              </button>
            </div>
            <button onClick={() => setHistoryOffset(0)}
              className={cn(
                "w-full px-2 py-2 rounded-full text-[8px] font-bold uppercase tracking-[0.05em] transition-all whitespace-nowrap",
                isLive
                  ? "bg-teal-500 text-white shadow-lg shadow-teal-500/20"
                  : "bg-slate-900 border border-slate-800 text-slate-500 hover:text-white"
              )}>
              ● Live
            </button>
          </div>
        </div>

        {/* Alerts Section — lee del store en tiempo real */}
        <div className="flex flex-col mt-2 px-1">
          <span className="text-[9px] font-medium text-slate-400 uppercase tracking-[0.2em] mb-1">Recent Alerts</span>
          <div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto scrollbar-hide">
            {alerts.length === 0 ? (
              <span className="text-[9px] text-slate-600 italic px-1">No alerts</span>
            ) : (
              alerts.slice(0, 5).map(alert => (
                <div key={alert.id}
                  className={cn(
                    "flex items-center gap-3 p-2 rounded border flex-shrink-0",
                    severityColor[alert.severity] ?? severityColor.low
                  )}>
                  <span className="text-[8px] text-slate-500 font-bold uppercase flex-shrink-0">{alert.timestamp}</span>
                  <span className="text-[10px] font-medium text-white truncate">{alert.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Slider */}
        <div className="px-2 py-1">
          <input
            type="range"
            min={-MAX_HISTORY_SECONDS}
            max="0"
            step="10"
            value={-historyOffset}
            onChange={(e) => setHistoryOffset(-parseInt(e.target.value))}
            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
          />
        </div>
      </div>

      {/* Timestamp dinámico */}
      <div className="flex justify-center items-center gap-2 mt-0.5">
        <span className="text-base font-bold tabular-nums tracking-wider bg-black px-4 flex items-center gap-2">
          <span className={cn("transition-colors", isLive ? "text-slate-500" : "text-slate-400")}>
            {displayTime.date}
          </span>
          <span className="opacity-30 text-slate-500">|</span>
          <span className={cn("transition-colors", isLive ? "text-teal-400" : "text-slate-300")}>
            {displayTime.time}
          </span>
          {isLive && (
            <span className="text-[8px] font-bold text-teal-500 uppercase tracking-widest animate-pulse">LIVE</span>
          )}
        </span>
      </div>
    </div>
  );
};

export default AdvancedControls;
