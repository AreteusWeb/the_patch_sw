/**
 * Central sensor-data freshness for Normal / Fitness dashboards.
 *
 * LIVE  — patch connected and streaming real samples
 * STALE — previously had samples; patch offline (show last values dimmed)
 * DEMO  — built-in simulator stream (startSim), not a clinical device
 * NO_DATA — never received samples (or cleared)
 */

import { useEffect, useMemo, useState } from 'react';
import useStore from '../store/useStore';
import type { DataFreshness } from '../types';

export interface DataFreshnessInfo {
  freshness: DataFreshness;
  /** True only for real device LIVE stream (not DEMO). */
  isLiveData: boolean;
  /** Dim numeric panels / waveforms (everything except LIVE). */
  dimmed: boolean;
  lastRealDataAt: number | null;
  /** Short relative age for STALE badge, e.g. "2 min". Null if not STALE. */
  staleAgeLabel: string | null;
}

/** Compact relative age for "Last data: {label}". */
export function formatStaleAge(lastRealDataAt: number, now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - lastRealDataAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  if (hr < 48) return `${hr}h`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

export function deriveDataFreshness(args: {
  isConnected: boolean;
  hasRealData: boolean;
  isSimulatedStream: boolean;
  lastRealDataAt: number | null;
}): DataFreshness {
  const { isConnected, hasRealData, isSimulatedStream, lastRealDataAt } = args;

  // DEMO takes priority while the in-app simulator is feeding the WS path.
  if (isSimulatedStream && isConnected) return 'DEMO';

  // LIVE = device linked and we have accepted real samples this session.
  if (isConnected && hasRealData) return 'LIVE';

  // STALE = we still know a last reading after disconnect / reconnect wait.
  if (hasRealData || lastRealDataAt != null) return 'STALE';

  return 'NO_DATA';
}

/**
 * Reactive freshness selector — same source of truth as the header STATUS line.
 */
export function useDataFreshness(): DataFreshnessInfo {
  const isConnected = useStore((s) => s.isConnected);
  const hasRealData = useStore((s) => s.hasRealData);
  const lastRealDataAt = useStore((s) => s.lastRealDataAt);
  const isSimulatedStream = useStore((s) => s.isSimulatedStream);

  const [now, setNow] = useState(() => Date.now());

  const freshness = useMemo(
    () =>
      deriveDataFreshness({
        isConnected,
        hasRealData,
        isSimulatedStream,
        lastRealDataAt,
      }),
    [isConnected, hasRealData, isSimulatedStream, lastRealDataAt]
  );

  // Tick relative "Last data" label while STALE.
  useEffect(() => {
    if (freshness !== 'STALE') return;
    const id = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(id);
  }, [freshness]);

  const staleAgeLabel =
    freshness === 'STALE' && lastRealDataAt != null
      ? formatStaleAge(lastRealDataAt, now)
      : null;

  return {
    freshness,
    isLiveData: freshness === 'LIVE',
    dimmed: freshness !== 'LIVE',
    lastRealDataAt,
    staleAgeLabel,
  };
}
