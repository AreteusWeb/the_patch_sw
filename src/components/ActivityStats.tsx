import React from 'react';
import { ChevronDown } from 'lucide-react';
import useStore from '../store/useStore';

/**
 * ActivityStats Component.
 * Displays real-time physical activity statistics including steps, calories burned,
 * and allows the user to select their current activity type.
 */
const ActivityStats: React.FC = () => {
  const { activity } = useStore();

  return (
    <div className="grid grid-cols-3 w-full py-4 border-t border-b border-slate-900 bg-slate-950/20 flex-shrink-0">
      <div className="flex flex-col items-center border-r border-slate-900">
        <span className="text-2xl font-medium text-white">{activity.steps.toLocaleString()}</span>
        <span className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">Steps</span>
      </div>
      <div className="flex flex-col items-center border-r border-slate-900">
        <span className="text-2xl font-medium text-white">{activity.calories}</span>
        <span className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">Calories</span>
      </div>
      <div className="flex flex-col items-center">
        <div className="relative group">
          <select 
            value={activity.activityType}
            onChange={(e) => useStore.getState().setActivityType(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer z-10"
          >
            <option value="Walking" className="bg-slate-900">Walking</option>
            <option value="Running" className="bg-slate-900">Running</option>
            <option value="Cycling" className="bg-slate-900">Cycling</option>
            <option value="Resting" className="bg-slate-900">Resting</option>
          </select>
          <span className="text-2xl font-medium text-white group-hover:text-emerald-400 transition-colors flex items-center gap-1">
            {activity.activityType}
            <ChevronDown size={14} className="opacity-40" />
          </span>
        </div>
        <span className="text-[9px] text-slate-500 uppercase tracking-widest mt-0.5">Activity</span>
      </div>
    </div>
  );
};

export default ActivityStats;
