import { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import { useFitnessSessionElapsed } from './useFitnessSessionElapsed';

/**
 * Seconds used for calorie estimates.
 * Recording/paused fitness session: that session clock (frozen while paused).
 * Otherwise: time since the patch connected.
 */
export function useCalorieElapsedSec(): number {
  const status = useStore(s => s.fitnessSessionStatus);
  const sessionElapsed = useFitnessSessionElapsed();
  const isConnected = useStore(s => s.isConnected);
  const patchConnectedAt = useStore(s => s.patchConnectedAt);
  const [now, setNow] = useState(() => Date.now());

  const useSessionClock = status === 'recording' || status === 'paused';

  useEffect(() => {
    if (useSessionClock || !isConnected || patchConnectedAt == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [useSessionClock, isConnected, patchConnectedAt]);

  useEffect(() => {
    setNow(Date.now());
  }, [isConnected, patchConnectedAt]);

  if (useSessionClock) return sessionElapsed;
  if (!isConnected || patchConnectedAt == null) return 0;
  return Math.max(0, Math.floor((now - patchConnectedAt) / 1000));
}
