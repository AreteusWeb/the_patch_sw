import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronDown, Check } from 'lucide-react';
import { cn } from '../utils/cn';
import useStore from '../store/useStore';

const MAX_HISTORY_SECONDS = 3600;

const RANGE_SECONDS: Record<string, number> = {
  '10 Min': 600,
  '1 Hr':   3600,
  '1 Day':  86400,
};

const EVENT_TYPE_MAP: Record<string, string[]> = {
  'Fall':        ['fall'],
  'Tachycardia': ['tachycardia', 'elevated_hr'],
  'Bradycardia': ['bradycardia'],
  'SpO2 Drop':   ['spo2drop'],
  'Fever':       ['fever'],
};

const AdvancedControls: React.FC = () => {
  const historyOffset    = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);
  const events           = useStore(s => s.events);
  const getEventsInRange = useStore(s => s.getEventsInRange);
  const jumpToEvent      = useStore(s => s.jumpToEvent);

  const ranges = ['10 Min', '1 Hr', '1 Day'];
  const [activeRange, setActiveRange] = React.useState<string | null>(null);
  const [filterIndex, setFilterIndex] = React.useState(0); // 0 = "Select Events" placeholder
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const isLive = historyOffset === 0;

  // Cerrar dropdown al click fuera
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
    const mm  = String(target.getMonth() + 1).padStart(2, '0');
    const dd  = String(target.getDate()).padStart(2, '0');
    const hh  = String(target.getHours()).padStart(2, '0');
    const min = String(target.getMinutes()).padStart(2, '0');
    const ss  = String(target.getSeconds()).padStart(2, '0');
    return { date: `${mm}/${dd}`, time: `${hh}:${min}:${ss}` };
  }, [historyOffset]);

  // Eventos filtrados — si no hay rango seleccionado, usar 1hr por defecto para el listado
  const eventsInRange = React.useMemo(() => {
    const rangeS = activeRange ? RANGE_SECONDS[activeRange] : 3600;
    return getEventsInRange(rangeS);
  }, [events, activeRange, getEventsInRange]);

  const filteredEvents = React.useMemo(() => {
    if (filterIndex === 0) return eventsInRange; // "Select Events" = todos
    const typeLabel = Object.keys(EVENT_TYPE_MAP)[filterIndex - 1];
    const allowed   = EVENT_TYPE_MAP[typeLabel] ?? [];
    return eventsInRange.filter(e => allowed.includes(e.type));
  }, [eventsInRange, filterIndex]);

  // Opciones del dropdown — solo tipos que realmente tienen eventos en el rango
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

  // Navegar entre eventos con «»
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

  // Evento más cercano al momento visible
  const nearestEvent = React.useMemo(() => {
    if (isLive || filteredEvents.length === 0) return null;
    const currentEpoch = Date.now() - historyOffset * 1000;
    return filteredEvents.find(e => Math.abs(e.timestampEpoch - currentEpoch) < 15000) ?? null;
  }, [isLive, historyOffset, filteredEvents]);

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5 bg-black">
      <div className="flex flex-col gap-1 mt-0.5">
        <div className="flex items-center justify-between gap-2">

          {/* Izquierda: «← + Past Status */}
          <div className="flex flex-col items-center gap-1.5 min-w-[75px]">
            <div className="flex gap-1">
              <button onClick={() => navigateEvent('prev')} title="Evento anterior"
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors">
                <ChevronsLeft size={16} className={filteredEvents.length > 0 ? "text-teal-400" : "text-slate-600"} />
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

            {/* Rangos — ninguno activo por defecto */}
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

            {/* Dropdown de eventos — estilo igual que el de leads */}
            <div className="relative z-50" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen(o => !o)}
                className="w-full flex items-center justify-between gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-bold text-slate-300 uppercase tracking-widest hover:border-teal-500/50 hover:bg-slate-800/80 transition-all shadow-lg active:scale-95"
              >
                <span className="truncate">
                  {selectedLabel}
                  {filterIndex > 0 && filteredEvents.length > 0 && (
                    <span className="ml-1.5 text-teal-400 normal-case">({filteredEvents.length})</span>
                  )}
                </span>
                <ChevronDown size={12} className={cn("text-slate-500 transition-transform duration-200 flex-shrink-0", dropdownOpen && "rotate-180")} />
              </button>

              {dropdownOpen && (
                <div className="absolute z-[100] bottom-full mb-1 left-1/2 -translate-x-1/2 min-w-[160px] bg-slate-900 border border-slate-700 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
                  <div className="max-h-[200px] overflow-y-auto">

                    {/* Opción "todos" */}
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

                    {/* Tipos con eventos */}
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
                            // Saltar al evento más reciente de este tipo
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

          {/* Derecha: →» + Live */}
          <div className="flex flex-col items-center gap-1.5 min-w-[75px]">
            <div className="flex gap-1">
              <button onClick={() => handleSeek('forward', 10)} title="10s adelante"
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors">
                <ChevronRight size={16} className="text-slate-400" />
              </button>
              <button onClick={() => navigateEvent('next')} title="Evento siguiente"
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors">
                <ChevronsRight size={16} className={filteredEvents.length > 0 ? "text-teal-400" : "text-slate-600"} />
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

        {/* Slider limpio — sin marcadores encima */}
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
        {nearestEvent && (
          <span className={cn(
            "text-[8px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border",
            nearestEvent.severity === 'high'
              ? "text-rose-400 bg-rose-500/10 border-rose-500/30"
              : "text-amber-400 bg-amber-500/10 border-amber-500/30"
          )}>
            {nearestEvent.label}
          </span>
        )}
      </div>
    </div>
  );
};

export default AdvancedControls;
