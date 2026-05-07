import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../utils/cn';
import useStore from '../store/useStore';
import CustomDropdown from './ui/CustomDropdown';

const MAX_HISTORY_SECONDS = 3600;

const RANGE_SECONDS: Record<string, number> = {
  '10 Min': 600,
  '1 Hr':   3600,
  '1 Day':  86400,
};

const EVENT_FILTER_OPTIONS = ['All Events', 'Fall', 'Tachycardia', 'Bradycardia', 'SpO2 Drop', 'Fever'];
const EVENT_TYPE_MAP: Record<string, string[]> = {
  'All Events':  [],
  'Fall':        ['fall'],
  'Tachycardia': ['tachycardia', 'elevated_hr'],
  'Bradycardia': ['bradycardia'],
  'SpO2 Drop':   ['spo2drop'],
  'Fever':       ['fever'],
};

const AdvancedControls: React.FC = () => {
  const historyOffset  = useStore(s => s.historyOffset);
  const setHistoryOffset = useStore(s => s.setHistoryOffset);
  const events         = useStore(s => s.events);
  const getEventsInRange = useStore(s => s.getEventsInRange);
  const jumpToEvent    = useStore(s => s.jumpToEvent);

  const ranges = ['10 Min', '1 Hr', '1 Day'];
  const [activeRange, setActiveRange] = React.useState('1 Hr');
  const [filterIndex, setFilterIndex] = React.useState(0);

  const isLive = historyOffset === 0;

  const displayTime = React.useMemo(() => {
    const target = new Date(Date.now() - historyOffset * 1000);
    const mm  = String(target.getMonth() + 1).padStart(2, '0');
    const dd  = String(target.getDate()).padStart(2, '0');
    const hh  = String(target.getHours()).padStart(2, '0');
    const min = String(target.getMinutes()).padStart(2, '0');
    const ss  = String(target.getSeconds()).padStart(2, '0');
    return { date: `${mm}/${dd}`, time: `${hh}:${min}:${ss}` };
  }, [historyOffset]);

  // Eventos filtrados por rango y tipo
  const filteredEvents = React.useMemo(() => {
    const rangeS      = RANGE_SECONDS[activeRange] ?? 3600;
    const inRange     = getEventsInRange(rangeS);
    const typeFilter  = EVENT_FILTER_OPTIONS[filterIndex];
    const allowed     = EVENT_TYPE_MAP[typeFilter] ?? [];
    return allowed.length === 0 ? inRange : inRange.filter(e => allowed.includes(e.type));
  }, [events, activeRange, filterIndex, getEventsInRange]);

  // Opciones del dropdown con conteos
  const dropdownOptions = React.useMemo(() => {
    const rangeS  = RANGE_SECONDS[activeRange] ?? 3600;
    const inRange = getEventsInRange(rangeS);
    return EVENT_FILTER_OPTIONS.map((label) => {
      const allowed = EVENT_TYPE_MAP[label] ?? [];
      const count   = allowed.length === 0
        ? inRange.length
        : inRange.filter(e => allowed.includes(e.type)).length;
      return count > 0 ? `${label} (${count})` : label;
    });
  }, [events, activeRange, getEventsInRange]);

  // Navegar entre eventos con «»
  const navigateEvent = (direction: 'prev' | 'next') => {
    if (filteredEvents.length === 0) return;
    const currentEpoch = Date.now() - historyOffset * 1000;

    if (direction === 'prev') {
      // Evento más reciente anterior al momento visible
      const prev = filteredEvents.find(e => e.timestampEpoch < currentEpoch - 2000);
      if (prev) jumpToEvent(prev);
    } else {
      // Evento más antiguo posterior al momento visible
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

  // Evento más cercano al momento visible (para mostrar label)
  const nearestEvent = React.useMemo(() => {
    if (isLive || filteredEvents.length === 0) return null;
    const currentEpoch = Date.now() - historyOffset * 1000;
    return filteredEvents.find(e => Math.abs(e.timestampEpoch - currentEpoch) < 15000) ?? null;
  }, [isLive, historyOffset, filteredEvents]);

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5 bg-black">
      <div className="flex flex-col gap-1 mt-0.5">
        <div className="flex items-center justify-between gap-2">

          {/* Izquierda */}
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

          {/* Centro */}
          <div className="flex-1 flex flex-col gap-1.5 p-1.5 bg-slate-900/30 border border-slate-800/50 rounded-xl min-w-[120px]">
            <div className="flex gap-1 justify-center">
              {ranges.map(range => (
                <button key={range} onClick={() => setActiveRange(range)}
                  className={cn(
                    "flex-1 px-1 py-2 rounded-full text-[10px] font-bold uppercase transition-all border border-slate-800 min-w-[30px]",
                    activeRange === range
                      ? "bg-teal-500 text-white border-teal-400 shadow-lg shadow-teal-500/20"
                      : "text-slate-500 hover:text-slate-300"
                  )}>
                  {range.replace(' Min', 'm').replace(' Hr', 'h').replace(' Day', 'd')}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setFilterIndex(0)}
                className={cn(
                  "flex-1 px-1.5 py-2 rounded-full text-[8px] font-bold uppercase tracking-tight border transition-colors",
                  filterIndex === 0
                    ? "bg-slate-800 text-white border-slate-700"
                    : "text-slate-500 border-slate-800 hover:text-slate-200"
                )}>
                All{filteredEvents.length > 0 ? <span className="ml-1 text-teal-400">{filteredEvents.length}</span> : null}
              </button>
              <CustomDropdown
                options={dropdownOptions}
                current={filterIndex}
                onSelect={setFilterIndex}
                className="flex-1"
                align="center"
                position="top"
              />
            </div>
          </div>

          {/* Derecha */}
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

        {/* Slider con marcadores de eventos */}
        <div className="px-2">
          {/* Marcadores de eventos sobre el slider */}
          <div className="relative h-3 mb-0.5">
            {filteredEvents.map(event => {
              const ageSeconds = (Date.now() - event.timestampEpoch) / 1000;
              if (ageSeconds > MAX_HISTORY_SECONDS) return null;
              const pct = Math.max(0, Math.min(100, 100 - (ageSeconds / MAX_HISTORY_SECONDS) * 100));
              return (
                <button
                  key={event.id}
                  onClick={() => jumpToEvent(event)}
                  title={event.label}
                  style={{ left: `${pct}%` }}
                  className={cn(
                    "absolute top-1 w-2 h-2 rounded-full -translate-x-1/2 transition-transform hover:scale-150 z-10",
                    event.severity === 'high' ? "bg-rose-500 shadow-rose-500/50 shadow-sm" : "bg-amber-400 shadow-amber-400/50 shadow-sm"
                  )}
                />
              );
            })}
          </div>
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
      <div className="flex justify-center mt-0.5 gap-2 items-center">
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
