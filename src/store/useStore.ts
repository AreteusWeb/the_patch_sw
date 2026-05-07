import { create } from 'zustand';
import { AppState, AppActions, SimulationMode, Alert, Vitals } from '../types';

// ─── Tipo de Evento ───────────────────────────────────────────────────────────
// Un Event es distinto a un Alert:
//   Alert  = notificación en el panel (texto, hora)
//   Event  = momento clínico con timestamp en segundos desde epoch
//             para poder saltar el slider a ese instante

export type EventType = 'fall' | 'tachycardia' | 'bradycardia' | 'spo2drop' | 'fever' | 'elevated_hr';

export interface ChestEvent {
  id: string;
  type: EventType;
  label: string;          // "Fall Detected", "Tachycardia", etc.
  severity: 'high' | 'medium' | 'low';
  timestampEpoch: number; // Date.now() en ms — para calcular offset del slider
  offsetSeconds: number;  // segundos desde ahora cuando se creó — snapshot para el slider
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface EventState {
  events: ChestEvent[];
  activeEventBanner: ChestEvent | null; // el que se muestra en el banner rojo
}

interface EventActions {
  addEvent: (event: Omit<ChestEvent, 'id' | 'offsetSeconds'>) => void;
  dismissBanner: () => void;
  jumpToEvent: (event: ChestEvent) => void;
  getEventsInRange: (rangeSeconds: number) => ChestEvent[];
}

const useStore = create<AppState & AppActions & EventState & EventActions>((set, get) => ({
  // ── Estado base ────────────────────────────────────────────────────────────
  isConnected: false,
  isLive: true,
  historyOffset: 0,
  viewMode: 'Normal',
  simulationMode: 'normal',
  vitals: {
    heartRate:       { value: 72,        unit: 'BPM', trend: 'stable', severity: 'normal' },
    spo2:            { value: 98,        unit: '%',   trend: 'stable', severity: 'normal' },
    temperature:     { value: 36.5,      unit: '°C',  trend: 'stable', severity: 'normal' },
    respirationRate: { value: 14,                     trend: 'stable', severity: 'normal' },
    bloodPressure:   { value: '118/75',               trend: 'stable', severity: 'normal' },
  },
  activity: {
    steps: 0,
    calories: 0,
    activityType: 'Walking',
  },
  alerts: [],
  events: [],
  activeEventBanner: null,
  batteryLevel: 80,
  connectionStatus: 'Stable',
  userName: 'User',
  deviceName: 'ChestPad v2',
  selectedLeadIndex: 0,
  isEcgExpanded: false,
  advancedEcgMode: 'All',
  isAdvancedMenuOpen: false,

  // ── Acciones base ──────────────────────────────────────────────────────────
  setConnected:        (connected) => set({ isConnected: connected }),
  setIsLive:           (isLive)    => set({ isLive, ...(isLive ? { historyOffset: 0 } : {}) }),
  setHistoryOffset:    (offset)    => set({ historyOffset: offset, isLive: offset === 0 }),
  setViewMode:         (mode)      => set({ viewMode: mode }),
  setSimulationMode:   (mode)      => set({ simulationMode: mode }),
  setBatteryLevel:     (level)     => set({ batteryLevel: level }),
  setConnectionStatus: (status)    => set({ connectionStatus: status }),
  setSelectedLeadIndex:(index)     => set({ selectedLeadIndex: index }),
  setIsEcgExpanded:    (expanded)  => set({ isEcgExpanded: expanded }),
  setAdvancedEcgMode:  (mode)      => set({ advancedEcgMode: mode }),
  setIsAdvancedMenuOpen:(isOpen)   => set({ isAdvancedMenuOpen: isOpen }),
  setActivityType:     (type)      => set((state) => ({ activity: { ...state.activity, activityType: type } })),

  updateVitals: (newVitals) => set((state) => {
    const updatedVitals = { ...state.vitals };
    (Object.keys(newVitals) as Array<keyof Vitals>).forEach((key) => {
      updatedVitals[key] = { ...updatedVitals[key], ...newVitals[key] };
    });
    return { vitals: updatedVitals };
  }),

  addAlert: (alert) => set((state) => ({
    alerts: [
      { ...alert, id: Math.random().toString(36).substr(2, 9) },
      ...state.alerts,
    ].slice(0, 100),
  })),

  // ── Acciones de eventos ────────────────────────────────────────────────────

  addEvent: (event) => set((state) => {
    const now = Date.now();
    const newEvent: ChestEvent = {
      ...event,
      id: Math.random().toString(36).substr(2, 9),
      timestampEpoch: now,
      offsetSeconds: 0, // acaba de ocurrir, offset = 0 en este momento
    };

    // También agregar como Alert para el panel
    const alertMsg = newEvent.label;
    const alertTime = new Date().toLocaleTimeString();

    return {
      events: [newEvent, ...state.events].slice(0, 200),
      activeEventBanner: newEvent,
      alerts: [
        { id: newEvent.id + '_alert', timestamp: alertTime, message: alertMsg, severity: event.severity },
        ...state.alerts,
      ].slice(0, 100),
    };
  }),

  dismissBanner: () => set({ activeEventBanner: null }),

  // Salta el slider al momento exacto del evento
  jumpToEvent: (event) => {
    const nowMs = Date.now();
    const offsetSeconds = Math.round((nowMs - event.timestampEpoch) / 1000);
    set({ historyOffset: offsetSeconds, isLive: false });
  },

  // Filtra eventos según el rango seleccionado (10min, 1hr, 1day)
  getEventsInRange: (rangeSeconds) => {
    const nowMs = Date.now();
    const cutoff = nowMs - rangeSeconds * 1000;
    return get().events.filter(e => e.timestampEpoch >= cutoff);
  },
}));

export default useStore;