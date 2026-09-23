/**
 * Pure helpers for training-session HR summary (avg / max / dominant zone).
 * Used after End Session flush so metrics match the full in-memory series.
 */

import type { TrainingHrSample } from './trainingSessions';
import { getHrZone } from '../utils/fitnessMetrics';
import { updateDoc, doc } from 'firebase/firestore';
import { db } from './firebase';
import { IS_LOCAL_MODE } from './appConfig';

export interface TrainingSessionSummaryMetrics {
  durationSec: number;
  avgHr: number;
  maxHr: number;
  dominantZone: string;
}

export type TrainingSessionSummaryResult =
  | { kind: 'ready'; metrics: TrainingSessionSummaryMetrics }
  | { kind: 'too_short'; durationSec: number };

/**
 * Intensity rank for dominant-zone ties — prefer the harder zone so a
 * Recovery↔Cardio tie surfaces Cardio (more useful for a training summary).
 */
const ZONE_INTENSITY_RANK: Record<string, number> = {
  Peak: 5,
  'High Intensity': 4,
  Cardio: 3,
  'Fat Burn': 2,
  Recovery: 1,
};

/** Reuse the same palette as getHrZone() / RUNNING UI. */
export function zoneColorForLabel(label: string): string {
  const bpmForLabel: Record<string, number> = {
    Recovery: 80,
    'Fat Burn': 110,
    Cardio: 130,
    'High Intensity': 150,
    Peak: 170,
  };
  return getHrZone(bpmForLabel[label] ?? 0).color;
}

/**
 * Compute summary from in-memory samples + accumulatedMs (already accounts
 * for pauses). Empty / near-empty series → too_short (never invent 0 bpm).
 */
export function computeTrainingSessionSummary(
  samples: TrainingHrSample[],
  accumulatedMs: number
): TrainingSessionSummaryResult {
  const durationSec = Math.max(0, Math.floor(accumulatedMs / 1000));

  if (samples.length === 0) {
    return { kind: 'too_short', durationSec };
  }

  let sum = 0;
  let maxHr = 0;
  const zoneCounts = new Map<string, number>();

  for (const s of samples) {
    sum += s.hr;
    if (s.hr > maxHr) maxHr = s.hr;
    zoneCounts.set(s.zone, (zoneCounts.get(s.zone) ?? 0) + 1);
  }

  // Dominant zone = most frequent sample (~10s each). Tie-break: higher
  // intensity rank (Peak > … > Recovery); if still tied, first seen wins.
  let dominantZone = samples[0].zone;
  let bestCount = -1;
  let bestRank = -1;
  for (const [zone, count] of zoneCounts) {
    const rank = ZONE_INTENSITY_RANK[zone] ?? 0;
    if (
      count > bestCount ||
      (count === bestCount && rank > bestRank)
    ) {
      bestCount = count;
      bestRank = rank;
      dominantZone = zone;
    }
  }

  return {
    kind: 'ready',
    metrics: {
      durationSec,
      avgHr: Math.round(sum / samples.length),
      maxHr,
      dominantZone,
    },
  };
}

/** Persist summary fields on the training session doc (cloud only). */
export async function writeTrainingSessionSummary(
  uid: string,
  sessionId: string,
  result: TrainingSessionSummaryResult
): Promise<void> {
  if (IS_LOCAL_MODE || !db) return;

  const patch =
    result.kind === 'ready'
      ? {
          durationSec: result.metrics.durationSec,
          avgHr: result.metrics.avgHr,
          maxHr: result.metrics.maxHr,
          dominantZone: result.metrics.dominantZone,
        }
      : {
          durationSec: result.durationSec,
          avgHr: null,
          maxHr: null,
          dominantZone: null,
        };

  await updateDoc(doc(db, 'users', uid, 'trainingSessions', sessionId), patch);
}
