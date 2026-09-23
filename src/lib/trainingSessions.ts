/**
 * trainingSessions.ts — Firestore persistence for Fitness Start Session.
 *
 * Path (mirrors coachSessions under the user):
 *   users/{uid}/trainingSessions/{sessionId}
 *
 * hrSamples are embedded (arrayUnion appends) — not a subcollection — because
 * expected volume is low (~360 samples/hour at 10s) and the future session
 * summary needs the full series in one read.
 */

import {
  arrayUnion,
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { IS_LOCAL_MODE } from './appConfig';

/** Zone labels match getHrZone().label (Recovery, Fat Burn, Cardio, …). */
export interface TrainingHrSample {
  elapsedSec: number;
  hr: number;
  zone: string;
  capturedAt: number;
}

export type TrainingSessionStatus = 'recording' | 'paused' | 'ended';

export interface TrainingSessionDoc {
  startedAt: number;
  endedAt: number | null;
  status: TrainingSessionStatus;
  accumulatedMs: number;
  hrSamples: TrainingHrSample[];
  /** Written on End by sessionSummary after the final hrSamples flush. */
  durationSec: number | null;
  avgHr: number | null;
  maxHr: number | null;
  dominantZone: string | null;
}

function sessionsCol(uid: string) {
  return collection(db!, 'users', uid, 'trainingSessions');
}

function sessionRef(uid: string, sessionId: string) {
  return doc(db!, 'users', uid, 'trainingSessions', sessionId);
}

/** Allocate a Firestore id without writing (same pattern as coachSessions). */
export function allocateTrainingSessionId(uid: string): string | null {
  if (IS_LOCAL_MODE || !db) return null;
  return doc(sessionsCol(uid)).id;
}

/**
 * Create the session document on first Start (not Resume).
 * Summary fields stay null until End → flush → computeTrainingSessionSummary.
 */
export async function createTrainingSession(
  uid: string,
  sessionId: string,
  startedAt: number
): Promise<void> {
  if (IS_LOCAL_MODE || !db) return;

  const payload: TrainingSessionDoc = {
    startedAt,
    endedAt: null,
    status: 'recording',
    accumulatedMs: 0,
    hrSamples: [],
    durationSec: null,
    avgHr: null,
    maxHr: null,
    dominantZone: null,
  };
  await setDoc(sessionRef(uid, sessionId), payload);
}

/**
 * Append buffered HR samples with arrayUnion so we never need to read the
 * doc first (avoids overwrite races). Also sync status / accumulatedMs /
 * endedAt for the current lifecycle event.
 */
export async function flushTrainingSession(
  uid: string,
  sessionId: string,
  opts: {
    status: TrainingSessionStatus;
    accumulatedMs: number;
    endedAt?: number | null;
    samples?: TrainingHrSample[];
  }
): Promise<void> {
  if (IS_LOCAL_MODE || !db) return;

  const patch: Record<string, unknown> = {
    status: opts.status,
    accumulatedMs: opts.accumulatedMs,
  };
  if (opts.endedAt !== undefined) {
    patch.endedAt = opts.endedAt;
  }
  // arrayUnion appends each object; each sample has unique capturedAt so
  // duplicates from a retry won't silently collapse distinct ticks either.
  if (opts.samples && opts.samples.length > 0) {
    patch.hrSamples = arrayUnion(...opts.samples);
  }

  await updateDoc(sessionRef(uid, sessionId), patch);
}

/**
 * Defensive cleanup: mark leftover recording/paused docs as ended before a
 * brand-new Start. This is NOT session recovery after refresh — just avoids
 * permanent zombie "recording" docs if the tab died mid-session.
 */
export async function endZombieTrainingSessions(uid: string): Promise<void> {
  if (IS_LOCAL_MODE || !db) return;

  const openStatuses: TrainingSessionStatus[] = ['recording', 'paused'];
  const snap = await getDocs(
    query(sessionsCol(uid), where('status', 'in', openStatuses))
  );
  if (snap.empty) return;

  const now = Date.now();
  const batch = writeBatch(db!);
  for (const d of snap.docs) {
    batch.update(d.ref, {
      status: 'ended',
      endedAt: now,
    });
  }
  await batch.commit();
}
