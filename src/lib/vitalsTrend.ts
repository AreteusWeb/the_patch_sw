/**
 * Trend data for the sidebar mini charts, taken from useWebSocket's
 * per-second vitals history (one point per second while the patch streams).
 * In-memory only: it's a short-term display aid and resets on reload.
 */

/** Per-second values, oldest first. null = no usable reading that second. */
export interface VitalsTrend {
  hr: (number | null)[];
  spo2: (number | null)[];
  rr: (number | null)[];
}

export const EMPTY_VITALS_TREND: VitalsTrend = { hr: [], spo2: [], rr: [] };

/**
 * Session Trends (right sidebar, Normal + Fitness): last 10 minutes.
 * Long enough to show a real change (warm-up, an interval, recovery after
 * effort) while keeping each bar a readable ~20 s average in a w-56 column;
 * the full 1 h buffer would squash minutes of change into a few pixels.
 */
export const SESSION_TREND_WINDOW_SEC = 10 * 60;
export const SESSION_TREND_BARS = 30;

/**
 * Quick Vitals sparklines (left sidebar, Normal): last 5 minutes.
 * They sit next to the current value, so they answer "where has this been
 * heading recently?" — a shorter window than Session Trends on purpose, so
 * the two charts on screen don't just duplicate each other.
 */
export const QUICK_VITALS_TREND_WINDOW_SEC = 5 * 60;
export const QUICK_VITALS_TREND_BARS = 20;

/** The hook only needs to expose as much history as the longest chart uses. */
export const TREND_HISTORY_EXPOSED_SEC = SESSION_TREND_WINDOW_SEC;

/**
 * Below 30 s of readings there's no trend to speak of — the chart shows its
 * empty state instead of a couple of bars that look like data.
 */
export const MIN_TREND_POINTS = 30;

/**
 * Y-axis span floors. Without them, min–max scaling stretches ±1 bpm of
 * jitter across the full bar height and a flat HR looks like a big swing.
 */
export const TREND_MIN_RANGE = { hr: 10, spo2: 3, rr: 6 } as const;

export interface TrendBuckets {
  /** Bucket averages, oldest first. null = no readings in that bucket. */
  buckets: (number | null)[];
  /** Seconds of history covered (≤ the requested window). */
  spanSec: number;
  min: number;
  max: number;
}

/**
 * Averages the last `windowSec` per-second points into at most `bars`
 * buckets. Bucket width adapts to how much history exists, so a 2-minute-old
 * session still fills the chart; spanSec says how much time it really covers.
 * Returns null when there aren't enough readings to call it a trend.
 */
export function buildTrendBuckets(
  values: (number | null)[],
  windowSec: number,
  bars: number,
): TrendBuckets | null {
  const recent = values.slice(-windowSec);
  const validCount = recent.reduce<number>((n, v) => (isReading(v) ? n + 1 : n), 0);
  if (validCount < MIN_TREND_POINTS) return null;

  const bucketSize = Math.max(1, Math.ceil(recent.length / bars));
  const buckets: (number | null)[] = [];
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < recent.length; i += bucketSize) {
    let sum = 0;
    let n = 0;
    for (const v of recent.slice(i, i + bucketSize)) {
      if (isReading(v)) {
        sum += v;
        n++;
      }
    }
    if (n === 0) {
      buckets.push(null);
      continue;
    }
    const avg = sum / n;
    buckets.push(avg);
    if (avg < min) min = avg;
    if (avg > max) max = avg;
  }

  return { buckets, spanSec: recent.length, min, max };
}

export function formatTrendSpan(spanSec: number): string {
  if (spanSec < 60) return `${spanSec}s`;
  return `${Math.round(spanSec / 60)}m`;
}

function isReading(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
