/**
 * Keeps store.trainingLoad in sync with Firestore trainingSessions.
 *
 * Refetches when:
 *   - the signed-in user changes,
 *   - a training session finishes (its summary is written before
 *     fitnessSessionSummary flips to ready / too_short),
 *   - the tab becomes visible again and the data is older than STALE_MS
 *     (the 7-day window slides, and sessions may come from another device).
 */

import { useCallback, useEffect, useRef } from 'react';
import useStore from '../store/useStore';
import { IS_LOCAL_MODE } from '../lib/appConfig';
import {
  computeTrainingLoad,
  fetchRecentTrainingSessions,
} from '../lib/trainingLoad';

const STALE_MS = 10 * 60 * 1000;

export function useTrainingLoadSync(): void {
  const uid = useStore((s) => s.currentUser?.uid ?? null);
  const summaryStatus = useStore((s) => s.fitnessSessionSummary?.status ?? null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const { setTrainingLoad, trainingLoad } = useStore.getState();

    if (IS_LOCAL_MODE) {
      setTrainingLoad({ status: 'unavailable', reason: 'local_mode' });
      return;
    }
    if (!uid) {
      setTrainingLoad({ status: 'unavailable', reason: 'signed_out' });
      return;
    }

    const hasData =
      trainingLoad.status === 'ready' || trainingLoad.status === 'no_recent_activity';
    if (!hasData) setTrainingLoad({ status: 'loading' });

    const requestId = ++requestIdRef.current;
    try {
      const sessions = await fetchRecentTrainingSessions(uid);
      if (requestId !== requestIdRef.current) return;
      setTrainingLoad(computeTrainingLoad(sessions));
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.warn('[trainingLoad] fetch failed:', err);
      // Keep the last good value on a refresh failure; only show error if none.
      if (!hasData) setTrainingLoad({ status: 'error' });
    }
  }, [uid]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (summaryStatus === 'ready' || summaryStatus === 'too_short') {
      void load();
    }
  }, [summaryStatus, load]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const tl = useStore.getState().trainingLoad;
      const computedAt =
        tl.status === 'ready' || tl.status === 'no_recent_activity' ? tl.computedAt : 0;
      if (Date.now() - computedAt > STALE_MS) void load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [load]);
}
