import React from 'react';
import { ArrowUp, ArrowDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import useStore from '../store/useStore';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../utils/cn';
import { SeverityLevel, VitalStatus } from '../types';

const SeverityArrows: React.FC<{ trend: 'up' | 'down' | 'stable'; severity: SeverityLevel; color: string; size: number }> = ({ trend, severity, color, size }) => {
  if (severity === 'normal') {
    return null;
  }
  
  if (trend === 'up') {
    return <ArrowUp size={size} className={color} strokeWidth={2} />;
  } else if (trend === 'down') {
    return <ArrowDown size={size} className={color} strokeWidth={2} />;
  }

  return null;
};

const VitalCard: React.FC<{ 
  label: string; 
  status: VitalStatus;
  color?: string;
  size?: 'sm' | 'normal' | 'xl';
  showUnit?: boolean;
}> = ({ label, status, color = "text-white", size = 'normal', showUnit = true }) => (
  <div className="flex flex-col items-center">
    <div className="flex items-center gap-1">
      <div className="flex items-baseline">
        <span 
          className={cn(
            "font-light tracking-tight transition-colors duration-300",
            size === 'xl' ? 'text-7xl' : size === 'normal' ? 'text-4xl' : 'text-2xl',
            color
          )}
        >
          {status.value}
        </span>
        {showUnit && status.unit && (
          <span className={cn(
            "font-light transition-all duration-300 ml-1",
            size === 'xl' ? 'text-2xl' : size === 'normal' ? 'text-lg' : 'text-xs',
            color
          )}>{status.unit}</span>
        )}
      </div>
      <SeverityArrows 
        trend={status.trend} 
        severity={status.severity} 
        color={color} 
        size={size === 'xl' ? 36 : size === 'normal' ? 24 : 18} 
      />
    </div>
    <span className={cn(
      "font-normal text-slate-500 uppercase tracking-widest mt-1 transition-all duration-300",
      size === 'sm' ? 'text-[8px]' : 'text-xs'
    )}>{label}</span>
  </div>
);

interface VitalsDisplayProps {
  compact?: boolean;
}

const VitalsDisplay: React.FC<VitalsDisplayProps> = ({ compact }) => {
  const vitals = useStore(state => state.vitals);

  return (
    <div className={cn(
      "relative flex flex-col items-center gap-1 flex-shrink-0 transition-all duration-300",
      compact ? "py-1" : "py-4"
    )}>
      {/* Top Row: SpO2 and Blood Pressure */}
      <div className={cn(
        "flex justify-between w-full mb-1 transition-all duration-300",
        compact ? "px-12" : "px-8"
      )}>
        <VitalCard 
          label="SpO2" 
          status={vitals.spo2} 
          color="text-white" 
          size={compact ? 'sm' : 'normal'} 
        />
        <VitalCard 
          label="Blood Pressure" 
          status={vitals.bloodPressure} 
          size={compact ? 'sm' : 'normal'}
        />
      </div>

      {/* Center: BPM */}
      <div className="relative flex items-center justify-center w-full px-4 mb-0.5">
        <VitalCard 
          label="BPM" 
          status={vitals.heartRate} 
          size={compact ? 'normal' : 'xl'} 
          showUnit={false}
        />
      </div>

      {/* Bottom Row: Temperature and Respiration Rate */}
      <div className={cn(
        "flex justify-between w-full transition-all duration-300",
        compact ? "px-12" : "px-8"
      )}>
        <VitalCard 
          label="Temperature" 
          status={vitals.temperature} 
          color={vitals.temperature.severity !== 'normal' ? "text-rose-400" : "text-white"} 
          size={compact ? 'sm' : 'normal'}
        />
        <VitalCard 
          label="Respiratory Rate" 
          status={vitals.respirationRate} 
          size={compact ? 'sm' : 'normal'}
        />
      </div>

      {/* Decorative Brackets pointing to center BPM (Mockup style) */}
      <div className={cn(
        "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full pointer-events-none z-0 transition-all duration-300"
      )}>
        <svg className="w-full h-full" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
          {/* Top bracket (V shape) */}
          <path d={compact ? "M 170 85 L 200 115 L 230 85" : "M 160 55 L 200 95 L 240 55"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          {/* Bottom bracket (^ shape) */}
          <path d={compact ? "M 170 215 L 200 185 L 230 215" : "M 160 245 L 200 205 L 240 245"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          {/* Left bracket ( > shape) */}
          <path d={compact ? "M 115 120 L 145 150 L 115 180" : "M 75 110 L 115 150 L 75 190"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          {/* Right bracket ( < shape) */}
          <path d={compact ? "M 285 120 L 255 150 L 285 180" : "M 325 110 L 285 150 L 325 190"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
        </svg>
      </div>
    </div>
  );
};

export default VitalsDisplay;
