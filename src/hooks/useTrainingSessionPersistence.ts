/**
 * Persist Fitness Start Session + HR time series to Firestore.
 *
 * Zustand remains the live UI source of truth. This hook mirrors lifecycle
 * transitions and samples HR while status === 'recording' AND data freshness
 * is LIVE — never while paused / stale / disconnected.
 *
 * Buffering:
 *   - Sample every SAMPLE_MS (10s) into an in-memory queue (+ full-session copy)
 *   - Flush with arrayUnion every FLUSH_MS (45s), and on pause / end /
 *     visibilitychange / beforeunload (best-effort — last ~45s may be lost
 *     on a hard kill; accepted trade-off, no Service Worker)
 *   - On End: flush pending first, then compute SUMMARY from the full
 *     in-memory series (so we never summarize a partial Firestore read)
 */

import { useEffect, useRef } from 'react';
import useStore from '../store/useStore';
import { IS_LOCAL_MODE } from '../lib/appConfig';
import { deriveDataFreshness } from './useDataFreshness';
import { getHrZone, getFitnessSessionElapsedSec } from '../utils/fitnessMetrics';
import {
  allocateTrainingSessionId,
  createTrainingSession,
  endZombieTrainingSessions,
  flushTrainingSession,
  type TrainingHrSample,
  type TrainingSessionStatus,
} from '../lib/trainingSessions';
import {
  computeTrainingSessionSummary,
  writeTrainingSessionSummary,
} from '../lib/sessionSummary';
import type { FitnessSessionStatus } from '../types';

/** Capture one HR point every 10s while LIVE + recording. */
const SAMPLE_MS = 10_000;
/**
 * Batch Firestore writes ~every 45s (within the 30–60s window) so we don't
 * pay one write per sample. Pause/end/hide flush immediately.
 */
const FLUSH_MS = 45_000;

function mapStatusForFirestore(
  status: FitnessSessionStatus
): TrainingSessionStatus | null {
  if (status === 'recording') return 'recording';
  if (status === 'paused') return 'paused';
  if (status === 'ended') return 'ended';
  return null;
}

export function useTrainingSessionPersistence(): void {
  const fitnessSessionStatus = useStore((s) => s.fitnessSessionStatus);
  const fitnessSessionId = useStore((s) => s.fitnessSessionId);
  const currentUser = useStore((s) => s.currentUser);

  /** Samples not yet flushed to Firestore. */
  const pendingRef = useRef<TrainingHrSample[]>([]);
  /** Full series for this session — used for SUMMARY (cloud + local). */
  const sessionSamplesRef = useRef<TrainingHrSample[]>([]);
  const prevStatusRef = useRef<FitnessSessionStatus>(fitnessSessionStatus);
  const creatingRef = useRef(false);
  const flushingRef = useRef(false);

  const flushPending = async (
    sessionId: string,
    status: TrainingSessionStatus,
    extra?: { endedAt?: number | null }
  ) => {
    if (IS_LOCAL_MODE) {
      // Local mode has no Firestore — keep sessionSamplesRef; only clear pending.
      pendingRef.current = [];
      return;
    }
    const uid = useStore.getState().currentUser?.uid;
    if (!uid || !sessionId) return;
    if (flushingRef.current) return;

    const samples = pendingRef.current.splice(0, pendingRef.current.length);
    const accumulatedMs = useStore.getState().fitnessSessionAccumulatedMs;

    flushingRef.current = true;
    try {
      await flushTrainingSession(uid, sessionId, {
        status,
        accumulatedMs,
        samples,
        endedAt: extra?.endedAt,
      });
    } catch (err) {
      // Put samples back so a later flush can retry (pause/end/timer).
      pendingRef.current = samples.concat(pendingRef.current);
      console.warn('[trainingSessions] flush failed:', err);
    } finally {
      flushingRef.current = false;
    }
  };

  const finalizeSummary = async (sessionId: string | null) => {
    const accumulatedMs = useStore.getState().fitnessSessionAccumulatedMs;
    const samples = sessionSamplesRef.current.slice();
    const result = computeTrainingSessionSummary(samples, accumulatedMs);

    const uid = useStore.getState().currentUser?.uid;
    if (uid && sessionId && !IS_LOCAL_MODE) {
      try {
        await writeTrainingSessionSummary(uid, sessionId, result);
      } catch (err) {
        console.warn('[trainingSessions] summary write failed:', err);
      }
    }

    if (result.kind === 'ready') {
      useStore.getState().setFitnessSessionSummary({
        status: 'ready',
        durationSec: result.metrics.durationSec,
        avgHr: result.metrics.avgHr,
        maxHr: result.metrics.maxHr,
        dominantZone: result.metrics.dominantZone,
      });
    } else {
      useStore.getState().setFitnessSessionSummary({
        status: 'too_short',
        durationSec: result.durationSec,
      });
    }
  };

  // ── Lifecycle: create on Start, sync pause/resume/end ────────────────────
  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = fitnessSessionStatus;
    prevStatusRef.current = next;

    if (prev === next) return;

    const uid = currentUser?.uid;
    const run = async () => {
      // idle/ended → recording = brand-new Start Session (not Resume).
      if (
        (prev === 'idle' || prev === 'ended') &&
        next === 'recording'
      ) {
        pendingRef.current = [];
        sessionSamplesRef.current = [];

        if (IS_LOCAL_MODE || !uid) {
          // Local: no Firestore doc, but sampling still fills sessionSamplesRef.
          return;
        }
        if (creatingRef.current) return;
        creatingRef.current = true;
        try {
          // Defensive: close any zombie open docs from a previous hard kill.
          await endZombieTrainingSessions(uid);

          const startedAt =
            useStore.getState().fitnessSessionStartedAt ?? Date.now();
          const sessionId = allocateTrainingSessionId(uid);
          if (!sessionId) return;

          await createTrainingSession(uid, sessionId, startedAt);
          useStore.getState().setFitnessSessionId(sessionId);
        } catch (err) {
          console.warn('[trainingSessions] create failed:', err);
        } finally {
          creatingRef.current = false;
        }
        return;
      }

      const sessionId = useStore.getState().fitnessSessionId;

      // Local End: no Firestore — still compute SUMMARY from memory.
      if (IS_LOCAL_MODE && next === 'ended') {
        await finalizeSummary(null);
        useStore.getState().setFitnessSessionId(null);
        pendingRef.current = [];
        // Keep sessionSamplesRef until next Start (cleared above).
        return;
      }

      if (!sessionId || !uid) {
        if (next === 'ended') {
          // Cloud without id (create failed) — still try memory summary.
          await finalizeSummary(null);
          useStore.getState().setFitnessSessionId(null);
          pendingRef.current = [];
        }
        return;
      }

      if (next === 'paused') {
        await flushPending(sessionId, 'paused');
        return;
      }

      if (prev === 'paused' && next === 'recording') {
        // Resume: same sessionId — only refresh status / accumulatedMs.
        await flushPending(sessionId, 'recording');
        return;
      }

      if (next === 'ended') {
        const endedAt = Date.now();
        // Flush MUST finish before summary so Firestore has the last samples;
        // SUMMARY itself is computed from sessionSamplesRef (complete series).
        await flushPending(sessionId, 'ended', { endedAt });
        await finalizeSummary(sessionId);
        useStore.getState().setFitnessSessionId(null);
        pendingRef.current = [];
      }
    };

    void run();
  }, [fitnessSessionStatus, currentUser?.uid]);

  // ── Sample every 10s while LIVE + recording ──────────────────────────────
  useEffect(() => {
    if (fitnessSessionStatus !== 'recording') return;
    // Cloud waits for Firestore id; local samples immediately.
    if (!fitnessSessionId && !IS_LOCAL_MODE) return;

    const tick = () => {
      const s = useStore.getState();
      if (s.fitnessSessionStatus !== 'recording') return;

      const freshness = deriveDataFreshness({
        isConnected: s.isConnected,
        hasRealData: s.hasRealData,
        isSimulatedStream: s.isSimulatedStream,
        lastRealDataAt: s.lastRealDataAt,
      });
      // Never persist stale / disconnected / demo-as-clinical HR.
      if (freshness !== 'LIVE') return;

      const hr = s.vitals.heartRate.value;
      if (typeof hr !== 'number' || hr <= 0) return;

      const elapsedSec = getFitnessSessionElapsedSec(
        s.fitnessSessionStatus,
        s.fitnessSessionStartedAt,
        s.fitnessSessionAccumulatedMs
      );
      const zone = getHrZone(hr).label;
      if (!zone || zone === '—') return;

      const sample: TrainingHrSample = {
        elapsedSec,
        hr,
        zone,
        capturedAt: Date.now(),
      };
      pendingRef.current.push(sample);
      sessionSamplesRef.current.push(sample);
    };

    // Immediate sample on enter LIVE recording, then every 10s.
    tick();
    const id = window.setInterval(tick, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [fitnessSessionStatus, fitnessSessionId]);

  // ── Periodic flush while a session is active ─────────────────────────────
  useEffect(() => {
    if (
      fitnessSessionStatus !== 'recording' &&
      fitnessSessionStatus !== 'paused'
    ) {
      return;
    }
    if (!fitnessSessionId || IS_LOCAL_MODE) return;

    const id = window.setInterval(() => {
      const status = mapStatusForFirestore(useStore.getState().fitnessSessionStatus);
      const sid = useStore.getState().fitnessSessionId;
      if (!status || !sid) return;
      if (pendingRef.current.length === 0) return;
      void flushPending(sid, status);
    }, FLUSH_MS);

    return () => window.clearInterval(id);
  }, [fitnessSessionStatus, fitnessSessionId]);

  // ── Best-effort flush on tab hide / unload ───────────────────────────────
  // Comment: this is best-effort only. A hard kill can still lose the last
  // ~30–60s of buffered samples — accepted; no Service Worker / sync queue.
  useEffect(() => {
    const tryFlush = () => {
      const s = useStore.getState();
      const sid = s.fitnessSessionId;
      const status = mapStatusForFirestore(s.fitnessSessionStatus);
      if (!sid || !status || IS_LOCAL_MODE) return;
      if (pendingRef.current.length === 0 && status === 'recording') return;
      void flushPending(sid, status);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') tryFlush();
    };

    window.addEventListener('beforeunload', tryFlush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', tryFlush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}
