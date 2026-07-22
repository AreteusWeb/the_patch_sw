import type { Activity, Vitals } from '../types';

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
    return { id: 'cardio', label: 'Cardio', color: '#fbbf24', barClass: 'bg-amber-400', intensity: 65 };
  }
  if (bpm < 160) {
    return { id: 'high', label: 'High Intensity', color: '#fb923c', barClass: 'bg-orange-400', intensity: 85 };
  }
  return { id: 'peak', label: 'Peak', color: '#f87171', barClass: 'bg-rose-400', intensity: 100 };
}

/**
 * Lightweight recovery score from available vitals (0–100).
 * Not a clinical HRV score — UI heuristic until a real recovery model exists.
 */
export function getRecoveryScore(vitals: Vitals, hasRealData: boolean): {
  score: number;
  label: string;
} {
  if (!hasRealData) return { score: 0, label: 'Awaiting data' };

  let score = 78;
  const hr = typeof vitals.heartRate.value === 'number' ? vitals.heartRate.value : null;
  const spo2 = typeof vitals.spo2.value === 'number' ? vitals.spo2.value : null;
  const rr = typeof vitals.respirationRate.value === 'number' ? vitals.respirationRate.value : null;

  if (spo2 != null) {
    if (spo2 >= 97) score += 10;
    else if (spo2 >= 94) score += 4;
    else score -= 18;
  }
  if (hr != null) {
    if (hr >= 50 && hr <= 100) score += 8;
    else if (hr > 140) score -= 12;
    else if (hr > 120) score -= 4;
  }
  if (rr != null) {
    if (rr >= 12 && rr <= 20) score += 4;
    else if (rr > 28) score -= 10;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const label =
    score >= 90 ? 'Excellent' :
    score >= 75 ? 'Good' :
    score >= 55 ? 'Fair' :
    'Low';

  return { score, label };
}

/** Rough HRV proxy (ms) from HR — placeholder until device exposes RR intervals. */
export function getHrvProxyMs(hr: number | string | undefined, hasRealData: boolean): number | null {
  if (!hasRealData || typeof hr !== 'number' || hr <= 0) return null;
  // Higher resting HR → typically lower HRV; clamp to a plausible display range.
  const proxy = Math.round(1200 / hr + (hr < 80 ? 18 : hr < 120 ? 8 : 0));
  return Math.max(25, Math.min(120, proxy));
}

export function getReadinessLabel(score: number, hasRealData: boolean): string {
  if (!hasRealData) return '—';
  if (score >= 85) return 'High';
  if (score >= 65) return 'Moderate';
  return 'Low';
}

export function getActivityIntensity(
  activity: Activity,
  hr: number | string | undefined
): { label: string; level: number } {
  const zone = getHrZone(hr);
  const fromSteps = Math.min(100, Math.round((activity.steps / 10000) * 70));
  const level = Math.max(zone.intensity * 0.7, fromSteps);
  const label =
    level >= 80 ? 'High' :
    level >= 50 ? 'Moderate' :
    level >= 20 ? 'Light' :
    'Rest';
  return { label, level: Math.round(level) };
}

export type WorkoutPhase = 'warm-up' | 'interval' | 'cool-down' | 'complete';

/** Map session progress (0–1) onto simple workout phases for the timeline UI. */
export function getWorkoutPhase(progress01: number): WorkoutPhase {
  if (progress01 < 0.15) return 'warm-up';
  if (progress01 < 0.75) return 'interval';
  if (progress01 < 0.95) return 'cool-down';
  return 'complete';
}

export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function estimateCalories(elapsedSeconds: number, hr: number | string | undefined, steps: number): number {
  const bpm = typeof hr === 'number' ? hr : 70;
  const hours = elapsedSeconds / 3600;
  const met = bpm < 100 ? 2.5 : bpm < 140 ? 6 : 9;
  const fromHr = Math.round(met * 70 * hours); // ~70kg reference
  const fromSteps = Math.round(steps * 0.04);
  return Math.max(fromHr, fromSteps);
}
