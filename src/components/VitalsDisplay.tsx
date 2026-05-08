import React from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';
import useStore from '../store/useStore';
import { cn } from '../utils/cn';
import { SeverityLevel, VitalStatus } from '../types';

const SeverityArrows: React.FC<{ trend: 'up' | 'down' | 'stable'; severity: SeverityLevel; color: string; size: number }> = ({ trend, severity, color, size }) => {
  if (severity === 'normal') return null;
  if (trend === 'up')   return <ArrowUp   size={size} className={color} strokeWidth={2} />;
  if (trend === 'down') return <ArrowDown size={size} className={color} strokeWidth={2} />;
  return null;
};

const VitalCard: React.FC<{
  label: string;
  status: VitalStatus;
  color?: string;
  size?: 'sm' | 'normal' | 'xl';
  showUnit?: boolean;
  frozen?: boolean;
}> = ({ label, status, color = "text-white", size = 'normal', showUnit = true, frozen }) => (
  <div className="flex flex-col items-center">
    <div className="flex items-center gap-1">
      <div className={cn(
        "flex items-baseline transition-opacity duration-300",
        frozen && "opacity-70"
      )}>
        <span className={cn(
          "font-light tracking-tight transition-colors duration-300",
          size === 'xl' ? 'text-7xl' : size === 'normal' ? 'text-4xl' : 'text-2xl',
          // En modo frozen, atenuar un poco para indicar que es pasado
          frozen ? "text-slate-400" : color
        )}>
          {status.value}
        </span>
        {showUnit && status.unit && (
          <span className={cn(
            "font-light transition-all duration-300 ml-1",
            size === 'xl' ? 'text-2xl' : size === 'normal' ? 'text-lg' : 'text-xs',
            frozen ? "text-slate-500" : color
          )}>{status.unit}</span>
        )}
      </div>
      {!frozen && (
        <SeverityArrows
          trend={status.trend}
          severity={status.severity}
          color={color}
          size={size === 'xl' ? 36 : size === 'normal' ? 24 : 18}
        />
      )}
    </div>
    <span className={cn(
      "font-normal uppercase tracking-widest mt-1 transition-all duration-300",
      size === 'sm' ? 'text-[8px]' : 'text-xs',
      frozen ? "text-slate-600" : "text-slate-500"
    )}>{label}</span>
  </div>
);

interface VitalsDisplayProps {
  compact?: boolean;
}

const VitalsDisplay: React.FC<VitalsDisplayProps> = ({ compact }) => {
  const vitals        = useStore(state => state.vitals);
  const historyOffset = useStore(state => state.historyOffset);

  // Congelamos una copia de los vitales en el momento en que historyOffset pasa de 0
  const frozenVitals = React.useRef(vitals);
  const wasFrozen    = React.useRef(false);

  const isFrozen = historyOffset > 0;

  if (isFrozen && !wasFrozen.current) {
    // Acabamos de entrar a modo histórico — congelar snapshot
    frozenVitals.current = vitals;
    wasFrozen.current = true;
  }
  if (!isFrozen && wasFrozen.current) {
    // Regresamos a live — descongelar
    wasFrozen.current = false;
  }

  const displayVitals = isFrozen ? frozenVitals.current : vitals;

  return (
    <div className={cn(
      "relative flex flex-col items-center gap-1 flex-shrink-0 transition-all duration-300",
      compact ? "py-1" : "py-4"
    )}>
      {/* Indicador de modo histórico */}
      {isFrozen && (
        <div className="absolute top-1 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20">
          <span className="w-1 h-1 rounded-full bg-teal-500" />
          <span className="text-[7px] font-bold uppercase tracking-widest text-teal-500">Past</span>
        </div>
      )}

      {/* Top Row: SpO2 and Blood Pressure */}
      <div className={cn(
        "flex justify-between w-full mb-1 transition-all duration-300",
        compact ? "px-12" : "px-8"
      )}>
        <VitalCard
          label="SpO2"
          status={displayVitals.spo2}
          color="text-white"
          size={compact ? 'sm' : 'normal'}
          frozen={isFrozen}
        />
        <VitalCard
          label="Blood Pressure"
          status={displayVitals.bloodPressure}
          size={compact ? 'sm' : 'normal'}
          frozen={isFrozen}
        />
      </div>

      {/* Center: BPM */}
      <div className="relative flex items-center justify-center w-full px-4 mb-0.5">
        <VitalCard
          label="BPM"
          status={displayVitals.heartRate}
          size={compact ? 'normal' : 'xl'}
          showUnit={false}
          frozen={isFrozen}
        />
      </div>

      {/* Bottom Row: Temperature and Respiration Rate */}
      <div className={cn(
        "flex justify-between w-full transition-all duration-300",
        compact ? "px-12" : "px-8"
      )}>
        <VitalCard
          label="Temperature"
          status={displayVitals.temperature}
          color={!isFrozen && displayVitals.temperature.severity !== 'normal' ? "text-rose-400" : "text-white"}
          size={compact ? 'sm' : 'normal'}
          frozen={isFrozen}
        />
        <VitalCard
          label="Respiratory Rate"
          status={displayVitals.respirationRate}
          size={compact ? 'sm' : 'normal'}
          frozen={isFrozen}
        />
      </div>

      {/* Decorative Brackets */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full pointer-events-none z-0 transition-all duration-300">
        <svg className="w-full h-full" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
          <path d={compact ? "M 170 85 L 200 115 L 230 85" : "M 160 55 L 200 95 L 240 55"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          <path d={compact ? "M 170 215 L 200 185 L 230 215" : "M 160 245 L 200 205 L 240 245"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          <path d={compact ? "M 115 120 L 145 150 L 115 180" : "M 75 110 L 115 150 L 75 190"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          <path d={compact ? "M 285 120 L 255 150 L 285 180" : "M 325 110 L 285 150 L 325 190"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
        </svg>
      </div>
    </div>
  );
};

export default VitalsDisplay;
