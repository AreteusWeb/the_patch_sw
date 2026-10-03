/**
 * Training Load — a summary of the athlete's recorded training sessions over
 * the last 7 days, built only from real `users/{uid}/trainingSessions` docs
 * (durationSec, avgHr, dominantZone, hrSamples written on End Session).
 *
 * This is an ACTIVITY summary ("how much and how hard you trained"), not a
 * physiological measurement of recovery, readiness, or fatigue.
 */

import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { IS_LOCAL_MODE } from './appConfig';
import type { TrainingHrSample } from './trainingSessions';

export const TRAINING_LOAD_WINDOW_DAYS = 7;
const WINDOW_MS = TRAINING_LOAD_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Same labels as getHrZone().label, lowest → highest intensity. */
export const TRAINING_ZONES = [
  'Recovery',
  'Fat Burn',
  'Cardio',
  'High Intensity',
  'Peak',
] as const;
export type TrainingZoneLabel = (typeof TRAINING_ZONES)[number];

/**
 * Zone weights — Edwards' summated-heart-rate-zones method (TRIMP): each
 * minute counts 1× in the easiest zone up to 5× in the hardest. Our five
 * getHrZone() bands map 1:1 onto Edwards' five zones, so "more time in high
 * zones = more load" falls out of the math instead of a hand-tuned formula.
 * Caveat: getHrZone() uses absolute bpm bands, not % of the athlete's max HR,
 * so the same workout can land one zone off for very fit or older athletes.
 */
const ZONE_WEIGHT: Record<TrainingZoneLabel, number> = {
  Recovery: 1,
  'Fat Burn': 2,
  Cardio: 3,
  'High Intensity': 4,
  Peak: 5,
};

/**
 * Weekly load cut-offs (sum of minutes × zone weight over 7 days).
 *
 * Anchored to the WHO adult activity guideline — 150–300 min/week moderate
 * OR 75–150 min/week vigorous. Treating moderate ≈ weight 2 (Fat Burn) and
 * vigorous ≈ weight 4 (High Intensity), both guideline ends line up:
 *   - 600 pts = 300 min moderate (×2) = 150 min vigorous (×4) → upper end of
 *     the guideline. At or above it the week is HIGH.
 *   - 150 pts = 75 min moderate (×2) ≈ 37 min vigorous (×4) → half of the
 *     guideline minimum. Below it the week is LOW.
 *   - Everything in between (which includes meeting the 150-min minimum,
 *     ~300 pts) is MODERATE.
 * Worked examples: 3 × 30 min mostly Cardio = 270 pts → Moderate;
 * 5 × 45 min mostly Cardio = 675 pts → High; 2 × 20 min Fat Burn = 80 → Low.
 */
const HIGH_LOAD_MIN_POINTS = 600;
const MODERATE_LOAD_MIN_POINTS = 150;

export type TrainingLoadLevel = 'high' | 'moderate' | 'low';

export interface TrainingLoadSummary {
  level: TrainingLoadLevel;
  label: 'High' | 'Moderate' | 'Low';
  windowDays: number;
  sessionCount: number;
  totalMinutes: number;
  avgSessionMinutes: number;
  /** Zone with the most minutes across the window (ties → harder zone). */
  dominantZone: TrainingZoneLabel | null;
  dominantZoneMinutes: number;
  zoneMinutes: Record<TrainingZoneLabel, number>;
  loadPoints: number;
}

export type TrainingLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  /** Local mode has no Firestore history; signed-out users have no uid. */
  | { status: 'unavailable'; reason: 'local_mode' | 'signed_out' }
  | { status: 'error' }
  | { status: 'no_recent_activity'; windowDays: number; computedAt: number }
  | { status: 'ready'; summary: TrainingLoadSummary; computedAt: number };

/** Fields this module reads from a trainingSessions doc. */
export interface TrainingSessionForLoad {
  startedAt: number;
  status: string;
  durationSec: number | null;
  avgHr: number | null;
  dominantZone: string | null;
  hrSamples?: TrainingHrSample[];
}

function isZone(z: unknown): z is TrainingZoneLabel {
  return typeof z === 'string' && (TRAINING_ZONES as readonly string[]).includes(z);
}

function emptyZoneMinutes(): Record<TrainingZoneLabel, number> {
  return { Recovery: 0, 'Fat Burn': 0, Cardio: 0, 'High Intensity': 0, Peak: 0 };
}

/**
 * Only sessions that ended with a real HR summary count. "Too short" sessions
 * (avgHr null — no LIVE HR sample) and zombie docs closed without a summary
 * are skipped: we can't say how hard they were, so they'd only add noise.
 */
function isCountable(s: TrainingSessionForLoad): boolean {
  return (
    s.status === 'ended' &&
    typeof s.durationSec === 'number' &&
    s.durationSec > 0 &&
    typeof s.avgHr === 'number' &&
    s.avgHr > 0
  );
}

/**
 * Split a session's duration across zones. hrSamples are ~10s LIVE ticks, so
 * their zone mix is the best estimate of where the time went; if a session
 * has no samples stored, all of it goes to its dominantZone.
 */
function sessionZoneMinutes(s: TrainingSessionForLoad): Record<TrainingZoneLabel, number> {
  const out = emptyZoneMinutes();
  const minutes = (s.durationSec ?? 0) / 60;
  const samples = (s.hrSamples ?? []).filter((x) => isZone(x?.zone));

  if (samples.length > 0) {
    for (const sample of samples) {
      out[sample.zone as TrainingZoneLabel] += minutes / samples.length;
    }
    return out;
  }
  if (isZone(s.dominantZone)) out[s.dominantZone] = minutes;
  return out;
}

export function computeTrainingLoad(
  sessions: TrainingSessionForLoad[],
  now: number = Date.now()
): TrainingLoadState {
  const since = now - WINDOW_MS;
  const countable = sessions.filter((s) => s.startedAt >= since && isCountable(s));

  if (countable.length === 0) {
    return {
      status: 'no_recent_activity',
      windowDays: TRAINING_LOAD_WINDOW_DAYS,
      computedAt: now,
    };
  }

  const zoneMinutes = emptyZoneMinutes();
  let totalMinutes = 0;
  for (const s of countable) {
    totalMinutes += (s.durationSec ?? 0) / 60;
    const perZone = sessionZoneMinutes(s);
    for (const z of TRAINING_ZONES) zoneMinutes[z] += perZone[z];
  }

  let loadPoints = 0;
  let dominantZone: TrainingZoneLabel | null = null;
  for (const z of TRAINING_ZONES) {
    loadPoints += zoneMinutes[z] * ZONE_WEIGHT[z];
    // TRAINING_ZONES is ordered easy → hard, so >= lets a harder zone win ties.
    if (zoneMinutes[z] > 0 && (dominantZone == null || zoneMinutes[z] >= zoneMinutes[dominantZone])) {
      dominantZone = z;
    }
  }

  for (const z of TRAINING_ZONES) zoneMinutes[z] = Math.round(zoneMinutes[z]);
  loadPoints = Math.round(loadPoints);

  const level: TrainingLoadLevel =
    loadPoints >= HIGH_LOAD_MIN_POINTS ? 'high'
      : loadPoints >= MODERATE_LOAD_MIN_POINTS ? 'moderate'
        : 'low';

  return {
    status: 'ready',
    computedAt: now,
    summary: {
      level,
      label: level === 'high' ? 'High' : level === 'moderate' ? 'Moderate' : 'Low',
      windowDays: TRAINING_LOAD_WINDOW_DAYS,
      sessionCount: countable.length,
      totalMinutes: Math.round(totalMinutes),
      avgSessionMinutes: Math.round(totalMinutes / countable.length),
      dominantZone,
      dominantZoneMinutes: dominantZone ? zoneMinutes[dominantZone] : 0,
      zoneMinutes,
      loadPoints,
    },
  };
}

/** Read the last 7 days of training sessions for this user (cloud only). */
export async function fetchRecentTrainingSessions(
  uid: string,
  now: number = Date.now()
): Promise<TrainingSessionForLoad[]> {
  if (IS_LOCAL_MODE || !db) return [];
  const snap = await getDocs(
    query(
      collection(db, 'users', uid, 'trainingSessions'),
      where('startedAt', '>=', now - WINDOW_MS)
    )
  );
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      startedAt: typeof data.startedAt === 'number' ? data.startedAt : 0,
      status: typeof data.status === 'string' ? data.status : '',
      durationSec: typeof data.durationSec === 'number' ? data.durationSec : null,
      avgHr: typeof data.avgHr === 'number' ? data.avgHr : null,
      dominantZone: typeof data.dominantZone === 'string' ? data.dominantZone : null,
      hrSamples: Array.isArray(data.hrSamples) ? data.hrSamples : [],
    };
  });
}

export function formatTrainingMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** e.g. "3 sessions · 1h 35m total · mostly Cardio (45 min)" */
export function describeTrainingLoad(summary: TrainingLoadSummary): string {
  const parts = [
    `${summary.sessionCount} ${summary.sessionCount === 1 ? 'session' : 'sessions'}`,
    `${formatTrainingMinutes(summary.totalMinutes)} total`,
  ];
  if (summary.dominantZone) {
    parts.push(
      `mostly ${summary.dominantZone} (${formatTrainingMinutes(summary.dominantZoneMinutes)})`
    );
  }
  return parts.join(' · ');
}

/**
 * Compact form sent to the AI Coach (metricsSnapshot.trainingLoad) and the
 * JSON export. null = history not loaded / unavailable — the coach is told to
 * say it doesn't have the training history rather than assume zero.
 */
export interface TrainingLoadSnapshot {
  kind: 'activity_summary';
  windowDays: number;
  status: 'ready' | 'no_recent_activity';
  level: TrainingLoadLevel | null;
  sessionCount: number;
  totalMinutes: number;
  avgSessionMinutes: number | null;
  dominantZone: TrainingZoneLabel | null;
  zoneMinutes: Record<TrainingZoneLabel, number> | null;
  loadPoints: number | null;
}

export function buildTrainingLoadSnapshot(
  state: TrainingLoadState
): TrainingLoadSnapshot | null {
  if (state.status === 'no_recent_activity') {
    return {
      kind: 'activity_summary',
      windowDays: state.windowDays,
      status: 'no_recent_activity',
      level: null,
      sessionCount: 0,
      totalMinutes: 0,
      avgSessionMinutes: null,
      dominantZone: null,
      zoneMinutes: null,
      loadPoints: null,
    };
  }
  if (state.status !== 'ready') return null;
  const s = state.summary;
  return {
    kind: 'activity_summary',
    windowDays: s.windowDays,
    status: 'ready',
    level: s.level,
    sessionCount: s.sessionCount,
    totalMinutes: s.totalMinutes,
    avgSessionMinutes: s.avgSessionMinutes,
    dominantZone: s.dominantZone,
    zoneMinutes: { ...s.zoneMinutes },
    loadPoints: s.loadPoints,
  };
}
