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

/** Real-time clinical alert details. */
export interface Alert {
  id: string;
  timestamp: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

/** Raw JSON message packet from the device containing multi-channel waveforms. */
export interface PhysiologicalPacket {
  /** Packet timestamp from source. */
  timestamp: number;
  /** Arrays of raw channel signal data: ch0-3: ECG, ch4: Resp, ch5: PPG, ch6: Temp, ch7: Audio */
  channels: number[][];
}

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
  /** ECG paper grid on waveform strips (clinical default: on). */
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
}
