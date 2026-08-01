import useStore from '../store/useStore';
import {
  estimateCalories,
  getFitnessSessionElapsedSec,
  getHrZone,
  getRecoveryScore,
} from './fitnessMetrics';

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stampFilename(prefix: string): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${prefix}_${stamp}.json`;
}

/**
 * Build a client-side JSON export of the current session / monitoring snapshot
 * and trigger a browser download. No backend required.
 */
export function exportSessionJson(kind: 'fitness' | 'clinical' = 'fitness') {
  const s = useStore.getState();
  const now = Date.now();
  const durationSec = getFitnessSessionElapsedSec(
    s.fitnessSessionStatus,
    s.fitnessSessionStartedAt,
    s.fitnessSessionAccumulatedMs,
    now,
  );
  const hr = s.vitals.heartRate.value;
  const zone = getHrZone(hr);
  const recovery = getRecoveryScore(s.vitals, s.hasRealData);
  const calories = estimateCalories(durationSec, hr, s.activity.steps);

  const sessionStartedAt =
    s.fitnessSessionStatus === 'idle'
      ? null
      : s.fitnessSessionStartedAt != null
        ? new Date(s.fitnessSessionStartedAt).toISOString()
        : s.fitnessSessionAccumulatedMs > 0
          ? new Date(now - durationSec * 1000).toISOString()
          : null;

  const payload = {
    exportedAt: new Date(now).toISOString(),
    app: 'Areteus The Patch',
    layout: kind,
    patient: {
      displayName:
        s.currentUser?.displayName
        ?? s.currentUser?.email?.split('@')[0]
        ?? s.userName,
      uid: s.currentUser?.uid ?? null,
      deviceMac: s.deviceMac,
      deviceName: s.deviceName,
    },
    connection: {
      isConnected: s.isConnected,
      status: s.connectionStatus,
      hasRealData: s.hasRealData,
      batteryLevel: s.batteryLevel,
    },
    session: {
      status: s.fitnessSessionStatus,
      durationSec,
      startedAt: sessionStartedAt,
      endedAt:
        s.fitnessSessionStatus === 'ended'
          ? new Date(now).toISOString()
          : null,
      accumulatedMs: s.fitnessSessionAccumulatedMs,
    },
    vitalsSummary: {
      heartRate: s.vitals.heartRate,
      spo2: s.vitals.spo2,
      respirationRate: s.vitals.respirationRate,
      temperature: s.vitals.temperature,
      bloodPressure: s.vitals.bloodPressure,
      hrZone: zone.label,
      recoveryScore: recovery.score,
      recoveryLabel: recovery.label,
    },
    activity: {
      ...s.activity,
      estimatedCalories: calories,
    },
    alerts: s.alerts.map(a => ({
      id: a.id,
      timestamp: a.timestamp,
      message: a.message,
      severity: a.severity,
    })),
    events: s.events.slice(0, 100).map(e => ({
      id: e.id,
      type: e.type,
      label: e.label,
      severity: e.severity,
      timestampEpoch: e.timestampEpoch,
      offsetSeconds: e.offsetSeconds,
      vitals: e.vitals ?? null,
    })),
    note:
      'Front-end snapshot export. Waveform sample arrays are not included yet; ' +
      'vitals/alerts/events reflect store state at export time.',
  };

  const prefix = kind === 'fitness' ? 'the-patch-fitness-session' : 'the-patch-clinical-export';
  downloadJson(stampFilename(prefix), payload);
}
