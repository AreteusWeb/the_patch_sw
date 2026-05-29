import React from 'react';
import { ArrowUp, ArrowDown, TriangleAlert, X } from 'lucide-react';
import useStore from '../store/useStore';
import { cn } from '../utils/cn';
import { SeverityLevel, VitalStatus } from '../types';

/**
 * Renders directional arrows indicating changes in vital severity trends.
 */
const SeverityArrows: React.FC<{ trend: 'up' | 'down' | 'stable'; severity: SeverityLevel; color: string; size: number }> = ({ trend, severity, color, size }) => {
  if (severity === 'normal') return null;
  if (trend === 'up') return <ArrowUp size={size} className={color} strokeWidth={2} />;
  if (trend === 'down') return <ArrowDown size={size} className={color} strokeWidth={2} />;
  return null;
};

/**
 * Resolves user-friendly alert labels depending on the type of vital sign
 * and its current deviation trend (high/low).
 */
const getAlertLabel = (label: string, status: VitalStatus): string | null => {
  if (status.severity === 'normal') return null;
  const isHigh = status.trend === 'up';
  switch (label) {
    case 'Temperature':      return isHigh ? 'High Temp' : 'Low Temp';
    case 'BPM':              return isHigh ? 'Elevated HR' : 'Low HR';
    case 'SpO2':             return 'Low SpO2';
    case 'Blood Pressure':   return isHigh ? 'High BP' : 'Low BP';
    case 'Respiratory Rate': return isHigh ? 'High Resp Rate' : 'Low Resp Rate';
    default:                 return 'Abnormal value';
  }
};

/**
 * VitalCard Component.
 * Displays an individual vital parameter (value, unit, trend, severity levels)
 * and shows alert tooltips if anomalies are detected.
 */
const VitalCard: React.FC<{
  label: string;
  status: VitalStatus;
  color?: string;
  size?: 'sm' | 'normal' | 'xl';
  showUnit?: boolean;
  frozen?: boolean;
  disconnected?: boolean;
  hasData?: boolean;         // ← new: false = show '--'
  onAlertTap?: () => void;
  goLiveSignal?: number;
}> = ({ label, status, color = "text-white", size = 'normal', showUnit = true, frozen, disconnected, hasData = true, onAlertTap, goLiveSignal }) => {
  const [dismissed, setDismissed] = React.useState(false);
  const dismissTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const stableSeverity = React.useRef<string>('normal');
  const stabilizeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const sev = status.severity;
    if (sev !== 'normal') {
      if (stabilizeTimer.current) { clearTimeout(stabilizeTimer.current); stabilizeTimer.current = null; }
      if (stableSeverity.current === 'normal') {
        stableSeverity.current = sev;
        setDismissed(false);
        if (dismissTimer.current) clearTimeout(dismissTimer.current);
        dismissTimer.current = setTimeout(() => setDismissed(true), 30_000);
      } else {
        stableSeverity.current = sev;
      }
    } else {
      if (stabilizeTimer.current) clearTimeout(stabilizeTimer.current);
      stabilizeTimer.current = setTimeout(() => {
        stableSeverity.current = 'normal';
        stabilizeTimer.current = null;
      }, 5_000);
    }
    return () => { if (stabilizeTimer.current) clearTimeout(stabilizeTimer.current); };
  }, [status.severity]);

  React.useEffect(() => {
    if (frozen) {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
      if (stabilizeTimer.current) clearTimeout(stabilizeTimer.current);
    }
  }, [frozen]);

  const stableStatus = { ...status, severity: stableSeverity.current as typeof status.severity };

  // Show '--' if there is no real data yet, if disconnected, or if frozen without data
  const showDash = !hasData || disconnected;

  const alertLabel = !frozen && !dismissed && !!onAlertTap && !showDash
    ? getAlertLabel(label, stableStatus)
    : null;

  const isXL = size === 'xl';

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1">
        <div className={cn(
          "flex items-baseline transition-opacity duration-300 relative",
          frozen && "opacity-70"
        )}>

          {/* Triángulo arriba-izquierda */}
          {alertLabel && (
            <div className={cn(
              "absolute animate-pulse",
              isXL ? "-top-4 -left-4" : "-top-3 -left-3"
            )}>
              <TriangleAlert size={isXL ? 16 : 11} className="text-rose-500" strokeWidth={2} />
            </div>
          )}

          {/* Tooltip compacto */}
          {alertLabel && (
            <div className={cn(
              "absolute z-20 pointer-events-auto",
              isXL ? "-top-5 left-6" : "-top-4 left-4"
            )}>
              <div className={cn(
                "relative flex items-center gap-1 bg-rose-950/95 border border-rose-500/30 rounded-full shadow-xl backdrop-blur-sm",
                isXL ? "px-2.5 py-1" : "px-2 py-0.5"
              )}>
                <button
                  className="text-left"
                  onClick={(e) => { e.stopPropagation(); onAlertTap?.(); }}
                >
                  <span className={cn(
                    "block font-bold text-rose-400 uppercase tracking-tight whitespace-nowrap",
                    isXL ? "text-[8px]" : "text-[7px]"
                  )}>
                    {alertLabel}
                  </span>
                </button>
                <button
                  className="flex items-center justify-center text-rose-500/60 hover:text-white transition-colors active:scale-95"
                  onClick={(e) => { e.stopPropagation(); setDismissed(true); }}
                >
                  <X size={8} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          )}

          {/* Number — '--' until real data arrives */}
          <span className={cn(
            "font-light tracking-tight transition-colors duration-300",
            isXL ? 'text-7xl' : size === 'normal' ? 'text-4xl' : 'text-2xl',
            frozen ? "text-slate-400" : showDash ? "text-slate-600" : color
          )}>
            {showDash ? '--' : status.value}
          </span>

          {/* Unit — only visible when there is data */}
          {showUnit && status.unit && !showDash && (
            <span className={cn(
              "font-light transition-all duration-300 ml-1",
              isXL ? 'text-2xl' : size === 'normal' ? 'text-lg' : 'text-xs',
              frozen ? "text-slate-500" : color
            )}>{status.unit}</span>
          )}
        </div>

        {/* Severity arrows — only with real data */}
        {!frozen && !showDash && (
          <SeverityArrows
            trend={status.trend}
            severity={status.severity}
            color={color}
            size={isXL ? 36 : size === 'normal' ? 24 : 18}
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
};

// ─── VitalsDisplay ────────────────────────────────────────────────────────────

/**
 * Properties for the VitalsDisplay component.
 */
interface VitalsDisplayProps {
  /** If true, renders a more compact representation of vitals grids. */
  compact?: boolean;
}

/**
 * VitalsDisplay Component.
 * Displays grid layouts of all vital parameter cards (SpO2, BP, HR, Temp, RR)
 * and handles history freezing overlays.
 */
const VitalsDisplay: React.FC<VitalsDisplayProps> = ({ compact }) => {
  const vitals        = useStore(state => state.vitals);
  const historyOffset = useStore(state => state.historyOffset);
  const activeEvent   = useStore(state => state.activeEventBanner);
  const jumpToEvent   = useStore(state => state.jumpToEvent);
  const events        = useStore(state => state.events);
  const viewMode      = useStore(state => state.viewMode);
  const isConnected   = useStore(state => state.isConnected);
  const hasRealData   = useStore(state => state.hasRealData);  // ← new flag
  const isAdvanced    = viewMode === 'Advanced';

  const frozenVitals = React.useRef(vitals);
  const wasFrozen    = React.useRef(false);
  const isFrozen     = historyOffset > 0;

  if (isFrozen && !wasFrozen.current) {
    frozenVitals.current = vitals;
    wasFrozen.current = true;
  }
  if (!isFrozen && wasFrozen.current) {
    wasFrozen.current = false;
  }

  const displayVitals = isFrozen ? frozenVitals.current : vitals;

  const prevOffset = React.useRef(historyOffset);
  const [goLiveSignal, setGoLiveSignal] = React.useState(0);
  React.useEffect(() => {
    if (prevOffset.current > 0 && historyOffset === 0) setGoLiveSignal(s => s + 1);
    prevOffset.current = historyOffset;
  }, [historyOffset]);

  const handleAlertTap = (eventTypes: string[]) => {
    const latest = events.find(e => eventTypes.includes(e.type));
    if (latest) {
      jumpToEvent(latest);
    } else if (activeEvent && eventTypes.includes(activeEvent.type)) {
      jumpToEvent(activeEvent);
    } else {
      useStore.getState().setHistoryOffset(5);
    }
  };

  return (
    <div className={cn(
      "relative flex flex-col items-center gap-1 flex-shrink-0 transition-all duration-300",
      compact ? "py-1" : "py-4"
    )}>

      {isFrozen && (
        <div className="absolute top-1 right-2 z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 border border-teal-500/20">
          <span className="w-1 h-1 rounded-full bg-teal-500" />
          <span className="text-[7px] font-bold uppercase tracking-widest text-teal-500">Past</span>
        </div>
      )}

      {/* Top Row: SpO2 + Blood Pressure */}
      <div className={cn("flex justify-between w-full mb-1 transition-all duration-300", compact ? "px-12" : "px-8")}>
        <VitalCard
          label="SpO2"
          status={displayVitals.spo2}
          color="text-white"
          size={compact ? 'sm' : 'normal'}
          frozen={isFrozen}
          disconnected={!isConnected}
          hasData={hasRealData}
          onAlertTap={isAdvanced ? () => handleAlertTap(['spo2_drop']) : undefined}
          goLiveSignal={goLiveSignal}
        />
        <VitalCard
          label="Blood Pressure"
          status={displayVitals.bloodPressure}
          size={compact ? 'sm' : 'normal'}
          frozen={isFrozen}
          disconnected={!isConnected}
          hasData={hasRealData}
          onAlertTap={isAdvanced ? () => handleAlertTap(['hypertension', 'hypotension']) : undefined}
          goLiveSignal={goLiveSignal}
        />
      </div>

      {/* Centro: BPM */}
      <div className="relative flex items-center justify-center w-full px-4 mb-0.5">
        <VitalCard
          label="BPM"
          status={displayVitals.heartRate}
          size={compact ? 'normal' : 'xl'}
          showUnit={false}
          frozen={isFrozen}
          disconnected={!isConnected}
          hasData={hasRealData}
          onAlertTap={isAdvanced ? () => handleAlertTap(['tachycardia', 'bradycardia']) : undefined}
          goLiveSignal={goLiveSignal}
        />
      </div>

      {/* Bottom Row: Temp + Resp */}
      <div className={cn("flex justify-between w-full transition-all duration-300", compact ? "px-12" : "px-8")}>
        <VitalCard
          label="Temperature"
          status={displayVitals.temperature}
          color={!isFrozen && displayVitals.temperature.severity !== 'normal' ? "text-rose-400" : "text-white"}
          size={compact ? 'sm' : 'normal'}
          frozen={isFrozen}
          disconnected={!isConnected}
          hasData={hasRealData}
          onAlertTap={isAdvanced ? () => handleAlertTap(['hyperthermia', 'hypothermia']) : undefined}
          goLiveSignal={goLiveSignal}
        />
        <VitalCard
          label="Respiratory Rate"
          status={displayVitals.respirationRate}
          size={compact ? 'sm' : 'normal'}
          frozen={isFrozen}
          disconnected={!isConnected}
          hasData={hasRealData}
          onAlertTap={isAdvanced ? () => handleAlertTap(['tachypnea', 'bradypnea']) : undefined}
          goLiveSignal={goLiveSignal}
        />
      </div>

      {/* Decorative brackets */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full pointer-events-none z-0 transition-all duration-300">
        <svg className="w-full h-full" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet">
          <path d={compact ? "M 170 45 L 200 75 L 230 45" : "M 160 40 L 200 80 L 240 40"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          <path d={compact ? "M 170 255 L 200 225 L 230 255" : "M 160 260 L 200 220 L 240 260"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          <path d={compact ? "M 95 120 L 125 150 L 95 180" : "M 75 110 L 115 150 L 75 190"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
          <path d={compact ? "M 305 120 L 275 150 L 305 180" : "M 325 110 L 285 150 L 325 190"} fill="none" stroke="#334155" strokeWidth="1" opacity="0.6" strokeLinecap="square" />
        </svg>
      </div>
    </div>
  );
};

export default VitalsDisplay;
