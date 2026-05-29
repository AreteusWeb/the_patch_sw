import React from 'react';
import { Home, Activity, Bell, User } from 'lucide-react';
import { cn } from '../utils/cn';

/**
 * BottomNav Component.
 * Renders the primary navigation menu at the bottom of the screen.
 */
const BottomNav: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState('Home');

  const tabs = [
    { name: 'Home', icon: Home },
    { name: 'ECG', icon: Activity },
    { name: 'Alerts', icon: Bell },
    { name: 'Mode', icon: User },
  ];

  return (
    <nav className="absolute bottom-[28px] left-0 right-0 h-20 bg-black/90 backdrop-blur-xl border-t border-slate-900 px-6 flex justify-between items-center z-50">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.name;
        
        return (
          <button
            key={tab.name}
            onClick={() => setActiveTab(tab.name)}
            className="flex flex-col items-center gap-1 min-w-[60px] group transition-all"
          >
            <div className={cn(
              "p-2 rounded-xl transition-colors",
              isActive ? "text-white" : "text-slate-500 group-hover:text-slate-300"
            )}>
              <Icon size={24} strokeWidth={isActive ? 2.5 : 2} />
            </div>
            <span className={cn(
              "text-[10px] font-medium leading-none",
              isActive ? "text-white" : "text-slate-500"
            )}>
              {tab.name}
            </span>
          </button>
        );
      })}
    </nav>
  );
};

export default BottomNav;
