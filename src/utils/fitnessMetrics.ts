export type HrZoneId = 'recovery' | 'fat_burn' | 'cardio' | 'high' | 'peak';

export interface HrZone {
  id: HrZoneId;
  label: string;
  color: string;
  barClass: string;
  /** 0–100 fill for zone meter */
  intensity: number;
}

/** Map current HR to a training zone (simple absolute bpm bands). */
export function getHrZone(hr: number | string | undefined): HrZone {
  const bpm = typeof hr === 'number' ? hr : 0;
  if (bpm <= 0) {
    return { id: 'recovery', label: '—', color: '#64748b', barClass: 'bg-slate-600', intensity: 0 };
  }
  if (bpm < 100) {
    return { id: 'recovery', label: 'Recovery', color: '#34d399', barClass: 'bg-emerald-400', intensity: 25 };
  }
  if (bpm < 120) {
    return { id: 'fat_burn', label: 'Fat Burn', color: '#2dd4bf', barClass: 'bg-teal-400', intensity: 45 };
  }
  if (bpm < 140) {
    return { id: 'cardio', label: 'Cardio', color: '#22d3ee', barClass: 'bg-cyan-400', intensity: 65 };
  }
  if (bpm < 160) {
    return { id: 'high', label: 'High Intensity', color: '#38bdf8', barClass: 'bg-sky-400', intensity: 85 };
  }
  return { id: 'peak', label: 'Peak', color: '#60a5fa', barClass: 'bg-blue-400', intensity: 100 };
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/** Live session clock — updates every second (m:ss or h:mm:ss). */
export function formatSessionClock(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Elapsed seconds for the front-only fitness session state machine. */
export function getFitnessSessionElapsedSec(
  status: 'idle' | 'recording' | 'paused' | 'ended',
  startedAt: number | null,
  accumulatedMs: number,
  nowMs: number = Date.now(),
): number {
  if (status === 'idle') return 0;
  const running =
    status === 'recording' && startedAt != null ? nowMs - startedAt : 0;
  return Math.floor((accumulatedMs + running) / 1000);
}

/**
 * MET × body weight × hours. Returns null when weight is unknown —
 * never substitutes a default kg.
 */
export function estimateCalories(
  elapsedSeconds: number,
  hr: number | string | undefined,
  steps: number,
  weightKg: number | null
): number | null {
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) return null;
  const hours = Math.max(0, elapsedSeconds) / 3600;
  const bpm = typeof hr === 'number' && hr > 0 ? hr : null;
  const met = bpm == null ? 0 : bpm < 100 ? 2.5 : bpm < 140 ? 6 : 9;
  const fromHr = Math.round(met * weightKg * hours);
  const fromSteps = Math.round(steps * 0.04);
  return Math.max(fromHr, fromSteps);
}
