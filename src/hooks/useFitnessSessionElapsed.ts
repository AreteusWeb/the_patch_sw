import { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { getFitnessSessionElapsedSec } from '../utils/fitnessMetrics';

/**
 * Live elapsed seconds for the Fitness Start Session state machine.
 * Ticks every 1s while status === 'recording'; frozen while paused/ended.
 */
export function useFitnessSessionElapsed(): number {
  const status = useStore(s => s.fitnessSessionStatus);
  const startedAt = useStore(s => s.fitnessSessionStartedAt);
  const accumulatedMs = useStore(s => s.fitnessSessionAccumulatedMs);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status !== 'recording') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status]);

  // Refresh immediately when status / anchors change (pause/resume/end)
  useEffect(() => {
    setNow(Date.now());
  }, [status, startedAt, accumulatedMs]);

  return getFitnessSessionElapsedSec(status, startedAt, accumulatedMs, now);
}
