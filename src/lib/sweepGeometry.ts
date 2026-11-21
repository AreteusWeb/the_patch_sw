/**
 * Pure time → x mapping for the hospital-style sweep trace.
 *
 * The strip does not scroll. A sample lands at
 *   x = (timestamp mod window) / window * width
 * and a cursor sits on the newest data time. Samples newer than the cursor
 * are not drawn. Samples from the previous lap stay visible to the right of
 * the cursor, except for a blank gap just in front of it.
 *
 * Cursor policy (no samples → paused):
 *   Before the first sample the cursor stays at the left edge and does not
 *   move. After that it tracks data time, leading the last sample by at most
 *   `maxExtrapolateMs` (default 120) so the bar glides between ~100 ms packets.
 *   If nothing arrives for longer than that, the cursor pauses. It does not
 *   keep erasing the strip on the wall clock — a disconnected device or a
 *   backgrounded tab must not wipe the last trace.
 */

export const SWEEP_SAMPLE_RATE_HZ = 250;
export const SWEEP_SAMPLE_PERIOD_MS = 1000 / SWEEP_SAMPLE_RATE_HZ;
/** Fixed on-screen window. The ring holds more than this so the prop can grow. */
export const SWEEP_WINDOW_MS = 6_000;
export const SWEEP_MIN_WINDOW_MS = 1_000;
export const SWEEP_MAX_WINDOW_MS = 16_000;
/** Blank band just in front of the cursor, as a fraction of the trace width. */
export const SWEEP_GAP_FRACTION = 0.04;
/**
 * How far the cursor may glide past the last sample while the next packet is
 * still in flight. Past this, the cursor pauses (device quiet / tab woken
 * after a long gap — we do not fast-forward across hidden time).
 */
export const SWEEP_MAX_EXTRAPOLATE_MS = 120;
/** Break the stroke when consecutive samples are farther apart than this. */
export const SWEEP_GAP_BREAK_MS = 160;
export const SWEEP_CHANNEL_COUNT = 11;
/** Ring length. Must be longer than SWEEP_MAX_WINDOW_MS. */
export const SWEEP_RING_SECONDS = 20;

const UNIX_MS_MIN = 1e12;
const UNIX_SECONDS_MIN = 1e9;

export function clampSweepWindowMs(windowMs: number): number {
  if (!Number.isFinite(windowMs)) return SWEEP_WINDOW_MS;
  if (windowMs < SWEEP_MIN_WINDOW_MS) return SWEEP_MIN_WINDOW_MS;
  if (windowMs > SWEEP_MAX_WINDOW_MS) return SWEEP_MAX_WINDOW_MS;
  return windowMs;
}

export function clampGapFraction(fraction: number): number {
  if (!Number.isFinite(fraction) || fraction <= 0) return 0;
  if (fraction > 0.5) return 0.5;
  return fraction;
}

/**
 * Horizontal position inside one sweep lap.
 * `windowMs` and `widthPx` must be > 0; otherwise the result is 0.
 * Negative timestamps wrap into the window (JS `%` keeps the sign).
 */
export function sweepX(timestampMs: number, windowMs: number, widthPx: number): number {
  if (!(windowMs > 0) || !(widthPx > 0) || !Number.isFinite(timestampMs)) return 0;
  const mod = ((timestampMs % windowMs) + windowMs) % windowMs;
  return (mod / windowMs) * widthPx;
}

/**
 * A sample is drawn only when it is at or behind the cursor and still inside
 * the current window. Equality with the cursor is visible (the point under
 * the bar). A sample exactly one window behind has just fallen off.
 */
export function sampleIsDrawable(
  sampleTimeMs: number,
  cursorTimeMs: number,
  windowMs: number,
): boolean {
  if (!(windowMs > 0) || !Number.isFinite(sampleTimeMs) || !Number.isFinite(cursorTimeMs)) {
    return false;
  }
  if (sampleTimeMs > cursorTimeMs) return false;
  if (cursorTimeMs - sampleTimeMs >= windowMs) return false;
  return true;
}

/**
 * Blank gap immediately to the right of the cursor. It is clipped at the
 * right edge and does not wrap onto the new trace on the left — wrapping it
 * would erase samples that were just written.
 * The sample sitting on the cursor (`x === cursorX`) is not part of the gap.
 */
export function isInEraseGap(
  x: number,
  cursorX: number,
  gapPx: number,
  widthPx: number,
): boolean {
  if (!(gapPx > 0) || !(widthPx > 0)) return false;
  const end = Math.min(widthPx, cursorX + gapPx);
  return x > cursorX + 0.5 && x < end;
}

/**
 * Cursor time. `null` when there is no sample yet (caller parks the bar).
 * `nowPerfMs` / `lastRecvPerfMs` share the `performance.now()` clock.
 */
export function cursorTimeMs(
  lastSampleTimeMs: number | null,
  lastRecvPerfMs: number,
  nowPerfMs: number,
  maxExtrapolateMs: number,
): number | null {
  if (lastSampleTimeMs == null || !Number.isFinite(lastSampleTimeMs)) return null;
  const cap = maxExtrapolateMs > 0 ? maxExtrapolateMs : 0;
  const elapsed = Number.isFinite(nowPerfMs) && Number.isFinite(lastRecvPerfMs)
    ? Math.max(0, nowPerfMs - lastRecvPerfMs)
    : 0;
  return lastSampleTimeMs + Math.min(elapsed, cap);
}

/** Device / server timestamp → milliseconds on a single axis. */
export function timestampToMs(raw: number): number {
  if (!Number.isFinite(raw)) return Number.NaN;
  if (raw >= UNIX_MS_MIN) return raw;
  if (raw >= UNIX_SECONDS_MIN) return raw * 1000;
  return raw;
}

export interface PacketTimeAnchor {
  /** Time of sample index 0. Later samples are start + index * period. */
  startMs: number;
  /**
   * Clock jumped more than a second backwards (device reboot, simulator
   * restart). The caller clears the ring so the new epoch does not
   * interleave with the old one. Small jitter is not a reset — those
   * samples are simply older than the cursor and get dropped.
   * A forward hole does not reset either: the window predicate drops
   * expired laps and the stroke breaks across the hole.
   */
  reset: boolean;
}

export function resolvePacketStartMs(
  rawTimestamp: number | null | undefined,
  samplePeriodMs: number,
  receivedAtMs: number,
  lastSampleTimeMs: number | null,
): PacketTimeAnchor {
  const period = samplePeriodMs > 0 ? samplePeriodMs : SWEEP_SAMPLE_PERIOD_MS;
  const raw = rawTimestamp == null ? Number.NaN : Number(rawTimestamp);
  if (!Number.isFinite(raw)) {
    const start = lastSampleTimeMs == null || !Number.isFinite(lastSampleTimeMs)
      ? receivedAtMs
      : lastSampleTimeMs + period;
    return { startMs: start, reset: false };
  }
  const start = timestampToMs(raw);
  if (lastSampleTimeMs == null || !Number.isFinite(lastSampleTimeMs)) {
    return { startMs: start, reset: false };
  }
  const delta = start - lastSampleTimeMs;
  // A few milliseconds of jitter must not wipe the strip. A full second
  // backwards means a new clock (reboot, simulator restart).
  return { startMs: start, reset: delta < -1_000 };
}

/**
 * First offset (from the oldest sample) whose time is >= minTime.
 * `times` is chronological once you walk `count` steps from `oldest`.
 */
export function firstAtOrAfter(
  times: Float64Array,
  oldest: number,
  count: number,
  capacity: number,
  minTime: number,
): number {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const idx = (oldest + mid) % capacity;
    if (times[idx] < minTime) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
