import { create } from 'zustand';
import { AppState, AppActions, SimulationMode, Alert, Vitals } from '../types';

import type { User as FirebaseUser } from 'firebase/auth';

import {
  saveEventWithVitals,
  processedFirestoreIds,
} from '../hooks/useFirestore';

/**
 * Represents the type of physiological event detected.
 */
export type EventType =
  | 'tachycardia'
  | 'bradycardia'
  | 'spo2_drop'
  | 'hyperthermia'
  | 'hypothermia'
  | 'tachypnea'
  | 'bradypnea'
  | 'hypertension'
  | 'hypotension';

/**
 * Represents a physiological event captured by the device.
 */
export interface ChestEvent {
  id: string;
  type: EventType;
  label: string;
  severity: 'high' | 'medium' | 'low';
  timestampEpoch: number;
  offsetSeconds: number;
  vitals?: {
    hr?: number;
    spo2?: number;
    temp?: number;
    rr?: number;
    bp?: string;
  };
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface EventState {
  events: ChestEvent[];
  activeEventBanner: ChestEvent | null;
}

interface EventActions {
  /**
   * Adds an event to the state history.
   * @param event - The event data to add (excluding auto-generated fields).
   * @param event.skipAlert - If true, adds the event to history but does NOT trigger a panel alert/banner.
   */
  addEvent: (event: Omit<ChestEvent, 'id' | 'offsetSeconds'> & { skipAlert?: boolean }) => void;
  /** Dismisses the active event banner notification. */
  dismissBanner: () => void;
  /** Sets the history offset to jump back to the timestamp of the given event. */
  jumpToEvent: (event: ChestEvent) => void;
  /** Retrieves events that occurred within a given range of seconds from now. */
  getEventsInRange: (rangeSeconds: number) => ChestEvent[];
}

interface AuthState {
  currentUser: FirebaseUser | null;
  deviceMac: string | null;
  authLoading: boolean;
}

interface AuthActions {
  setCurrentUser: (user: FirebaseUser | null) => void;
  setDeviceMac: (mac: string | null) => void;
  setAuthLoading: (loading: boolean) => void;
}

const useStore = create<
  AppState &
  AppActions &
  EventState &
  EventActions &
  AuthState &
  AuthActions
>((set, get) => ({

  // ── Base State ─────────────────────────────────────────────────────────────

  isConnected: false,
  isLive: true,
  historyOffset: 0,
  viewMode: 'Normal',
  simulationMode: 'normal',

  /**
   * Flag indicating whether real data has arrived from the device.
   * While false, VitalsDisplay shows '--' instead of default values.
   */
  hasRealData: false,

  vitals: {
    heartRate: {
      value: 72,
      unit: 'BPM',
      trend: 'stable',
      severity: 'normal',
    },
    spo2: {
      value: 98,
      unit: '%',
      trend: 'stable',
      severity: 'normal',
    },
    temperature: {
      value: 36.5,
      unit: '°C',
      trend: 'stable',
      severity: 'normal',
    },
    respirationRate: {
      value: 14,
      trend: 'stable',
      severity: 'normal',
    },
    bloodPressure: {
      value: '118/75',
      trend: 'stable',
      severity: 'normal',
    },
  },

  activity: {
    steps: 0,
    calories: 0,
    activityType: 'Walking',
  },

  alerts: [],
  events: [],
  activeEventBanner: null,

  batteryLevel: null,
  connectionStatus: 'Disconnected',

  userName: 'User',
  deviceName: 'ChestPad v2',

  selectedLeadIndex: 0,

  isEcgExpanded: false,
  advancedEcgMode: 'All',
  isAdvancedMenuOpen: false,
  notchFilterEnabled: false, //Apagado por default, igual que en viewer.js de Axel

  currentUser: null,
  deviceMac: null,
  authLoading: true,

  // ── Base Actions ───────────────────────────────────────────────────────────

  setHasRealData: (v: boolean) => set({ hasRealData: v }),

  setConnected: (connected) =>
    set({ isConnected: connected }),

  setIsLive: (isLive) =>
    set({
      isLive,
      ...(isLive ? { historyOffset: 0 } : {}),
    }),

  setHistoryOffset: (offset) =>
    set({
      historyOffset: offset,
      isLive: offset === 0,
    }),

  setViewMode: (mode) =>
    set({ viewMode: mode }),

  setSimulationMode: (mode) =>
    set({ simulationMode: mode }),

  setBatteryLevel: (level) =>
    set({ batteryLevel: level }),

  setConnectionStatus: (status) =>
    set({ connectionStatus: status }),

  setSelectedLeadIndex: (index) =>
    set({ selectedLeadIndex: index }),

  setIsEcgExpanded: (expanded) =>
    set({ isEcgExpanded: expanded }),

  setAdvancedEcgMode: (mode) =>
    set({ advancedEcgMode: mode }),

  setIsAdvancedMenuOpen: (isOpen) =>
    set({ isAdvancedMenuOpen: isOpen }),

  setNotchFilterEnabled: (enabled) =>
    set({ notchFilterEnabled: enabled }),

  setCurrentUser: (user) =>
    set({ currentUser: user }),

  setDeviceMac: (mac) =>
    set({ deviceMac: mac }),

  setAuthLoading: (loading) =>
    set({ authLoading: loading }),

  setActivityType: (type) =>
    set((state) => ({
      activity: {
        ...state.activity,
        activityType: type,
      },
    })),

  updateVitals: (newVitals) =>
    set((state) => {
      const updatedVitals = { ...state.vitals };

      (Object.keys(newVitals) as Array<keyof Vitals>).forEach((key) => {
        updatedVitals[key] = {
          ...updatedVitals[key],
          ...newVitals[key],
        };
      });

      return { vitals: updatedVitals };
    }),

  addAlert: (alert) =>
    set((state) => ({
      alerts: [
        {
          ...alert,
          id: Math.random().toString(36).substr(2, 9),
        },
        ...state.alerts,
      ].slice(0, 100),
    })),

  // ── Event Actions ──────────────────────────────────────────────────────────

  addEvent: ({ skipAlert, ...event }) =>
    set((state) => {

      const newEvent: ChestEvent = {
        ...event,
        id: Math.random().toString(36).substr(2, 9),
        timestampEpoch: event.timestampEpoch ?? Date.now(),
        offsetSeconds: 0,
      };

      const v = state.vitals;
      const userId = state.currentUser?.uid;

      // Only persist in Firestore if it does NOT come from Firestore (prevents loop)
      if (!skipAlert && userId) {
        saveEventWithVitals(
          {
            type: newEvent.type,
            label: newEvent.label,
            severity: newEvent.severity as 'high' | 'medium',
            timestampEpoch: newEvent.timestampEpoch,
          },
          {
            hr: v.heartRate.value as number,
            spo2: v.spo2.value as number,
            temp: v.temperature.value as number,
            rr: v.respirationRate.value as number,
            bp: v.bloodPressure.value as string,
          },
          userId
        ).then((firestoreId) => {
          if (firestoreId) {
            processedFirestoreIds.add(firestoreId);
          }
        });
      }

      // Panel alert only for real-time events
      const newAlerts = skipAlert
        ? state.alerts
        : [
            {
              id: newEvent.id + '_alert',
              timestamp: new Date(newEvent.timestampEpoch).toLocaleTimeString(),
              message: newEvent.label,
              severity: event.severity as 'high' | 'medium' | 'low',
            },
            ...state.alerts,
          ].slice(0, 100);

      return {
        events: [newEvent, ...state.events].slice(0, 200),
        activeEventBanner: skipAlert ? state.activeEventBanner : newEvent,
        alerts: newAlerts,
      };
    }),

  dismissBanner: () =>
    set({ activeEventBanner: null }),

  jumpToEvent: (event) => {
    const nowMs = Date.now();
    let offsetSeconds = Math.round((nowMs - event.timestampEpoch) / 1000);
    offsetSeconds = Math.max(5, offsetSeconds);
    set({
      historyOffset: offsetSeconds,
      isLive: false,
    });
  },

  getEventsInRange: (rangeSeconds) => {
    const nowMs = Date.now();
    const cutoff = nowMs - rangeSeconds * 1000;
    return get().events.filter((e) => e.timestampEpoch >= cutoff);
  },

}));

export default useStore;
