import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../utils/cn';
import useStore from '../store/useStore';
import CustomDropdown from './ui/CustomDropdown';

// Máximo de historia en segundos (1 hora)
const MAX_HISTORY_SECONDS = 3600;

const AdvancedControls: React.FC = () => {
  const { historyOffset, setHistoryOffset } = useStore();
  const ranges = ['10 Min', '1 Hr', '1 Day'];
  const [activeRange, setActiveRange] = React.useState('1 Hr');
  const [selectedEvent, setSelectedEvent] = React.useState(0);

  const isLive = historyOffset === 0;

  // Timestamp dinámico basado en el offset
  const displayTime = React.useMemo(() => {
    const now = new Date();
    const target = new Date(now.getTime() - historyOffset * 1000);
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    const hh = String(target.getHours()).padStart(2, '0');
    const min = String(target.getMinutes()).padStart(2, '0');
    const ss = String(target.getSeconds()).padStart(2, '0');
    return { date: `${mm}/${dd}`, time: `${hh}:${min}:${ss}` };
  }, [historyOffset]);

  const handleSeek = (direction: 'back' | 'forward', amount: number) => {
    const next = direction === 'back'
      ? Math.min(historyOffset + amount, MAX_HISTORY_SECONDS)
      : Math.max(0, historyOffset - amount);
    setHistoryOffset(next);
  };

  // Slider: max=0 es Live (derecha), min=-MAX es pasado (izquierda)
  // Usamos valor negativo en el slider para que la bolita esté a la derecha en Live
  const sliderValue = -historyOffset;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5 bg-black">
      <div className="flex flex-col gap-1 mt-0.5">
        <div className="flex items-center justify-between gap-2">

          {/* Izquierda: botones retroceder + Past Status */}
          <div className="flex flex-col items-center gap-1.5 min-w-[75px]">
            <div className="flex gap-1">
              <button
                onClick={() => handleSeek('back', 60)}
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors"
              >
                <ChevronsLeft size={16} className="text-slate-400" />
              </button>
              <button
                onClick={() => handleSeek('back', 10)}
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors"
              >
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

          {/* Centro: range + eventos */}
          <div className="flex-1 flex flex-col gap-1.5 p-1.5 bg-slate-900/30 border border-slate-800/50 rounded-xl min-w-[120px]">
            <div className="flex gap-1 justify-center">
              {ranges.map(range => (
                <button
                  key={range}
                  onClick={() => setActiveRange(range)}
                  className={cn(
                    "flex-1 px-1 py-2 rounded-full text-[10px] font-bold uppercase transition-all border border-slate-800 min-w-[30px]",
                    activeRange === range
                      ? "bg-teal-500 text-white border-teal-400 shadow-lg shadow-teal-500/20"
                      : "text-slate-500 hover:text-slate-300"
                  )}
                >
                  {range.replace(' Min', 'm').replace(' Hr', 'h').replace(' Day', 'd')}
                </button>
              ))}
            </div>
            <div className="flex gap-1">
              <button
                className={cn(
                  "flex-1 px-1.5 py-2 rounded-full text-[8px] font-bold uppercase tracking-tight border transition-colors",
                  selectedEvent === 0
                    ? "bg-slate-800 text-white border-slate-700"
                    : "text-slate-500 border-slate-800 hover:text-slate-200"
                )}
                onClick={() => setSelectedEvent(0)}
              >
                All Events
              </button>
              <CustomDropdown
                options={['Select', 'Fall', 'HR', 'SpO2']}
                current={selectedEvent}
                onSelect={setSelectedEvent}
                className="flex-1"
                align="center"
                position="top"
              />
            </div>
          </div>

          {/* Derecha: botones avanzar + Live */}
          <div className="flex flex-col items-center gap-1.5 min-w-[75px]">
            <div className="flex gap-1">
              <button
                onClick={() => handleSeek('forward', 10)}
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors"
              >
                <ChevronRight size={16} className="text-slate-400" />
              </button>
              <button
                onClick={() => handleSeek('forward', 60)}
                className="p-2.5 px-3 rounded-full border border-slate-800/80 hover:bg-slate-800/50 transition-colors"
              >
                <ChevronsRight size={16} className="text-slate-400" />
              </button>
            </div>
            <button
              onClick={() => setHistoryOffset(0)}
              className={cn(
                "w-full px-2 py-2 rounded-full text-[8px] font-bold uppercase tracking-[0.05em] transition-all whitespace-nowrap",
                isLive
                  ? "bg-teal-500 text-white shadow-lg shadow-teal-500/20"
                  : "bg-slate-900 border border-slate-800 text-slate-500 hover:text-white"
              )}
            >
              ● Live
            </button>
          </div>
        </div>

        {/* Slider — derecha = Live (0), izquierda = pasado (-MAX) */}
        <div className="px-2 py-0">
          <input
            type="range"
            min={-MAX_HISTORY_SECONDS}
            max="0"
            step="10"
            value={sliderValue}
            onChange={(e) => setHistoryOffset(-parseInt(e.target.value))}
            className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-teal-500"
          />
        </div>
      </div>

      {/* Timestamp dinámico */}
      <div className="flex justify-center mt-0.5">
        <span className="text-base font-bold tabular-nums tracking-wider bg-black px-4 flex items-center gap-2">
          <span className={cn("transition-colors", isLive ? "text-slate-500" : "text-slate-400")}>
            {displayTime.date}
          </span>
          <span className="opacity-30 text-slate-500">|</span>
          <span className={cn(
            "transition-colors",
            isLive ? "text-teal-400" : "text-slate-300"
          )}>
            {displayTime.time}
          </span>
          {isLive && (
            <span className="text-[8px] font-bold text-teal-500 uppercase tracking-widest animate-pulse">
              LIVE
            </span>
          )}
        </span>
      </div>
    </div>
  );
};

export default AdvancedControls;
