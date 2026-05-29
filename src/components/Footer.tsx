import React from 'react';
import useStore from '../store/useStore';
import { Battery, Wifi } from 'lucide-react';
import { cn } from '../utils/cn';

/**
 * Footer Component.
 * Displays battery levels and device connection status at the bottom of the layout.
 */
const Footer: React.FC = () => {
  const batteryLevel = useStore(state => state.batteryLevel);
  const isConnected  = useStore(state => state.isConnected);

  const connectionStatus = isConnected ? 'Stable' : 'Disconnected';
  const connectionColor  = isConnected ? 'text-emerald-400' : 'text-rose-400';

  const batteryColor = batteryLevel == null ? 'text-slate-500'
    : batteryLevel > 70 ? 'text-emerald-400'
    : batteryLevel > 30 ? 'text-yellow-400'
    : 'text-rose-400';

  return (
    <div className="w-full px-4 py-2 flex justify-between items-center bg-black/40 backdrop-blur-sm border-t border-white/5 z-[40]">
      <div className="flex items-center gap-1.5">
        <Battery size={10} className={cn("opacity-60", batteryColor)} />
        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.2em]">
          Battery: <span className={cn("text-slate-300", batteryColor)}>
            {batteryLevel != null ? `${batteryLevel}%` : '--'}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-right">
        <span className="text-[8px] font-bold text-slate-500 uppercase tracking-[0.2em]">
          Connection: <span className={cn("text-slate-300", connectionColor)}>{connectionStatus}</span>
        </span>
        <Wifi size={10} className={cn("opacity-60", connectionColor)} />
      </div>
    </div>
  );
};

export default Footer;