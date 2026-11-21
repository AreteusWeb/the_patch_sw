/**
 * Per-channel rings of (time, value) for the sweep trace.
 *
 * The hook writes here from the packet handler. The canvas reads here from
 * requestAnimationFrame. Neither side copies the arrays and neither calls
 * setState. Samples older than the ring length fall off the back.
 *
 * A sample older than the newest one already stored is dropped (a reordered
 * packet must not pull the cursor backwards or zigzag the stroke).
 */

import {
  SWEEP_CHANNEL_COUNT,
  SWEEP_RING_SECONDS,
  SWEEP_SAMPLE_RATE_HZ,
} from './sweepGeometry';

const DEFAULT_CAPACITY = SWEEP_SAMPLE_RATE_HZ * SWEEP_RING_SECONDS;

export class SweepChannel {
  readonly values: Float32Array;
  readonly times: Float64Array;
  head = 0;
  count = 0;
  lastTimeMs = Number.NaN;

  constructor(readonly capacity: number) {
    this.values = new Float32Array(capacity);
    this.times = new Float64Array(capacity);
  }

  get oldest(): number {
    return (this.head - this.count + this.capacity) % this.capacity;
  }

  clear() {
    this.head = 0;
    this.count = 0;
    this.lastTimeMs = Number.NaN;
  }
}

export class SweepBuffer {
  readonly channels: SweepChannel[];
  lastSampleTimeMs: number | null = null;
  lastRecvPerfMs = 0;
  generation = 0;

  constructor(
    channelCount = SWEEP_CHANNEL_COUNT,
    capacity = DEFAULT_CAPACITY,
  ) {
    this.channels = Array.from({ length: channelCount }, () => new SweepChannel(capacity));
  }

  reset() {
    for (let i = 0; i < this.channels.length; i++) this.channels[i].clear();
    this.lastSampleTimeMs = null;
    this.lastRecvPerfMs = 0;
    this.generation++;
  }

  /**
   * Append one sample. `perfNow` is performance.now() taken once per packet,
   * not once per sample.
   */
  write(channel: number, timeMs: number, value: number, perfNow: number) {
    const ch = this.channels[channel];
    if (!ch || !Number.isFinite(timeMs) || !Number.isFinite(value)) return;
    if (Number.isFinite(ch.lastTimeMs) && timeMs < ch.lastTimeMs) return;

    ch.values[ch.head] = value;
    ch.times[ch.head] = timeMs;
    ch.head = (ch.head + 1) % ch.capacity;
    if (ch.count < ch.capacity) ch.count++;
    ch.lastTimeMs = timeMs;

    if (this.lastSampleTimeMs == null || timeMs >= this.lastSampleTimeMs) {
      this.lastSampleTimeMs = timeMs;
      this.lastRecvPerfMs = perfNow;
    }
  }
}

/** Process-wide feed. One live socket writes it; the sweep canvases read it. */
export const sweepFeed = new SweepBuffer();
