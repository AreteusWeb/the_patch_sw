/** Available simulation signal modes. */
export type SimulationMode = 'normal' | 'tachycardia' | 'bradycardia' | 'spo2drop' | 'fever';

/** Desktop dashboard layout: clinical (default) vs fitness-focused. */
export type DesktopLayoutMode = 'normal' | 'fitness';

/** ECG paper strip display settings (digital grid / speed / gain). */
export type EcgPaperSpeedSetting = 25 | 50;
export type EcgGainSetting = 5 | 10 | 20;

/** Severity categorizations for parsed physiological vitals. */
export type SeverityLevel = 'normal' | 'moderate' | 'critical';

/** Status report for an individual vital measurement. */
export interface VitalStatus {
  /** Numeric or formatted string representation of vital value. */
  value: number | string;
  /** Measurement unit symbol (e.g. '%', 'BPM', '°C'). */
  unit?: string;
  /** Directional trend change vector. */
  trend: 'up' | 'down' | 'stable';
  /** Alarm severity level categorization. */
  severity: SeverityLevel;
}

/** Collection of active tracked physiological vital parameter statuses. */
export interface Vitals {
  heartRate: VitalStatus;
  spo2: VitalStatus;
  temperature: VitalStatus;
  respirationRate: VitalStatus;
  bloodPressure: VitalStatus;
}

/** Tracked physical activity statistics. */
export interface Activity {
  steps: number;
  calories: number;
  activityType: string;
}

/**
 * Sensor data freshness for monitoring UI.
 * LIVE = patch streaming now; STALE = last known after disconnect;
 * DEMO = built-in simulator stream; NO_DATA = never received samples.
 */
export type DataFreshness = 'LIVE' | 'STALE' | 'DEMO' | 'NO_DATA';

/** Real-time clinical alert details. */
export interface Alert {
  id: string;
  timestamp: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
  /** True once the patch left LIVE — shown as historical, not actionable. */
  historical?: boolean;
}

/** Raw JSON message packet from the device containing multi-channel waveforms. */
export interface PhysiologicalPacket {
  /** Packet timestamp from source. */
  timestamp: number;
  /** Arrays of raw channel signal data: ch0-3: ECG, ch4: Resp, ch5: PPG, ch6: Temp, ch7: Audio */
  channels: number[][];
}

/** Front-only fitness training session (no backend yet). */
export type FitnessSessionStatus = 'idle' | 'recording' | 'paused' | 'ended';

/** Store state layout representation. */
export interface AppState {
  isConnected: boolean;
  isLive: boolean;
  historyOffset: number; 
  viewMode: 'Normal' | 'Advanced';
  simulationMode: SimulationMode;
  vitals: Vitals;
  activity: Activity;
  alerts: Alert[];
  batteryLevel: number | null;
  connectionStatus: 'Stable' | 'Weak' | 'Disconnected' | 'Connecting';
  userName: string;
  deviceName: string;
  selectedLeadIndex: number;
  isEcgExpanded: boolean;
  advancedEcgMode: 'Single' | 'All';
  isAdvancedMenuOpen: boolean;
  notchFilterEnabled: boolean;
  desktopLayout: DesktopLayoutMode;
  /** ECG paper grid on waveform strips (default: off — enable for clinical paper view). */
  ecgGridEnabled: boolean;
  ecgPaperSpeed: EcgPaperSpeedSetting;
  ecgGain: EcgGainSetting;
  /** Click-drag Δt / ΔV measurement on paper-mode strips. */
  ecgMeasureEnabled: boolean;
  /**
   * True once live sensor data has arrived from the device.
   * While false, vitals UI shows '--' instead of placeholder defaults.
   */
  hasRealData: boolean;
  /** Wall-clock ms of the last packet that carried real samples. */
  lastRealDataAt: number | null;
  /** True while the built-in WS simulator (startSim) is feeding packets. */
  isSimulatedStream: boolean;
  /** Fitness Start Session state machine (front-only UI source of truth). */
  fitnessSessionStatus: FitnessSessionStatus;
  /** Wall-clock ms when the current recording segment started; null if not recording. */
  fitnessSessionStartedAt: number | null;
  /** Completed recording time (ms) from prior segments before the latest pause. */
  fitnessSessionAccumulatedMs: number;
  /**
   * Firestore `users/{uid}/trainingSessions/{id}` while recording/paused.
   * Cleared on end / new start. Null until the persistence hook creates the doc.
   */
  fitnessSessionId: string | null;
  /**
   * Post-End summary for the Training Session UI.
   * `null` = no summary yet; `calculating` while flush+compute run.
   */
  fitnessSessionSummary:
    | null
    | { status: 'calculating' }
    | { status: 'ready'; durationSec: number; avgHr: number; maxHr: number; dominantZone: string }
    | { status: 'too_short'; durationSec: number };
}

/** Action mutators for the Zustand store. */
export interface AppActions {
  setConnected: (connected: boolean) => void;
  setIsLive: (isLive: boolean) => void;
  setHistoryOffset: (offset: number) => void;
  setViewMode: (mode: 'Normal' | 'Advanced') => void;
  setSimulationMode: (mode: SimulationMode) => void;
  updateVitals: (vitals: Partial<Record<keyof Vitals, Partial<VitalStatus>>>) => void;
  addAlert: (alert: Omit<Alert, 'id'>) => void;
  setBatteryLevel: (level: number) => void;
  setConnectionStatus: (status: AppState['connectionStatus']) => void;
  setSelectedLeadIndex: (index: number) => void;
  setIsEcgExpanded: (isExpanded: boolean) => void;
  setAdvancedEcgMode: (mode: 'Single' | 'All') => void;
  setIsAdvancedMenuOpen: (isOpen: boolean) => void;
  setNotchFilterEnabled: (enabled: boolean) => void;
  setActivityType: (type: string) => void;
  setDesktopLayout: (layout: DesktopLayoutMode) => void;
  setEcgGridEnabled: (enabled: boolean) => void;
  setEcgPaperSpeed: (speed: EcgPaperSpeedSetting) => void;
  setEcgGain: (gain: EcgGainSetting) => void;
  setEcgMeasureEnabled: (enabled: boolean) => void;
  setHasRealData: (hasRealData: boolean) => void;
  setLastRealDataAt: (ms: number | null) => void;
  setIsSimulatedStream: (simulated: boolean) => void;
  /** Mark every alert as historical (called when leaving LIVE). */
  markAlertsHistorical: () => void;
  startFitnessSession: () => void;
  pauseFitnessSession: () => void;
  resumeFitnessSession: () => void;
  endFitnessSession: () => void;
  setFitnessSessionId: (id: string | null) => void;
  setFitnessSessionSummary: (summary: AppState['fitnessSessionSummary']) => void;
  /** After SUMMARY — back to idle so Start Session can begin a new workout. */
  resetFitnessSessionToIdle: () => void;
}
