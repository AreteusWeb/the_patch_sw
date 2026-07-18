/** Available simulation signal modes. */
export type SimulationMode = 'normal' | 'tachycardia' | 'bradycardia' | 'spo2drop' | 'fever';

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
}
