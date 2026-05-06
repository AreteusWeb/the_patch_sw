import React from 'react';
import useStore from '../store/useStore';
import { cn } from '../utils/cn';

const AlertsPanel: React.FC = () => {
  const staticAlerts = [
    { id: 1, timestamp: '10:11 AM', title: 'Elevated Heart Rate', value: '142 BPM' },
    { id: 2, timestamp: '10:35 AM', title: 'SpO2 Threshold Drop', value: '89%' }
  ];

  return (
    <div className="flex flex-col w-full px-6 py-4 flex-1 min-h-0 overflow-hidden">
      <h3 className="text-[10px] font-semibold text-slate-500 uppercase tracking-[0.2em] mb-2 flex-shrink-0">Recent Alerts</h3>
      <div className="flex flex-col gap-2 overflow-y-auto max-h-[120px] scrollbar-hide">
        {staticAlerts.map((alert) => (
          <div 
            key={alert.id}
            className="flex items-center gap-3 px-3 py-2 bg-slate-900/30 rounded-lg border border-white/5 flex-shrink-0"
          >
            <span className="text-[9px] font-medium text-slate-500 tabular-nums flex-shrink-0">{alert.timestamp}</span>
            <span className="text-[10px] font-medium text-white truncate">
              {alert.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AlertsPanel;
