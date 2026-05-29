import React from 'react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../utils/cn';

/**
 * Properties for the CustomDropdown component.
 */
interface CustomDropdownProps {
  /** Array of labels representing options in the dropdown. */
  options: string[];
  /** Index of the currently selected option. */
  current: number;
  /** Callback fired when an option is selected. */
  onSelect: (index: number) => void;
  /** Optional custom CSS classes. */
  className?: string;
  /** Alignment of the dropdown list relative to the button. */
  align?: 'left' | 'right' | 'center';
  /** Placement direction of the list window. */
  position?: 'top' | 'bottom';
}

/**
 * CustomDropdown Component.
 * A custom styled select menu overlay supporting custom alignment, position offsets, and item selections.
 */
const CustomDropdown: React.FC<CustomDropdownProps> = ({ 
  options, 
  current, 
  onSelect, 
  className,
  align = 'left',
  position = 'bottom'
}) => {
  const [isOpen, setIsOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={cn("relative z-50", className)} ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-1.5 px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-[10px] font-bold text-slate-300 uppercase tracking-widest hover:border-teal-500/50 hover:bg-slate-800/80 transition-all shadow-lg active:scale-95"
      >
        <span className="truncate">{options[current]}</span>
        <ChevronDown 
          size={12} 
          className={cn("text-slate-500 transition-transform duration-200 flex-shrink-0", isOpen && "rotate-180")} 
        />
      </button>

      {isOpen && (
        <div className={cn(
          "absolute z-[100] min-w-[140px] bg-slate-900 border border-slate-700 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in zoom-in-95 duration-150",
          position === 'top' ? "bottom-full mb-1" : "top-full mt-1",
          align === 'left' && "left-0",
          align === 'right' && "right-0",
          align === 'center' && "left-1/2 -translate-x-1/2"
        )}>
          <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
            {options.map((option, idx) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onSelect(idx);
                  setIsOpen(false);
                }}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 text-[9px] font-bold uppercase tracking-widest text-left transition-colors border-b border-white/5 last:border-0",
                  idx === current 
                    ? "bg-teal-500 text-white" 
                    : "text-slate-400 hover:bg-slate-800 hover:text-white"
                )}
              >
                <span>{option}</span>
                {idx === current && <Check size={12} className="text-white" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomDropdown;
