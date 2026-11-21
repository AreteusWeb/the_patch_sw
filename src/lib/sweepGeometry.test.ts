import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SweepBuffer } from './sweepFeed.ts';
import {
  cursorTimeMs,
  firstAtOrAfter,
  isInEraseGap,
  resolvePacketStartMs,
  sampleIsDrawable,
  sweepX,
  timestampToMs,
} from './sweepGeometry.ts';

const WINDOW = 6_000;
const WIDTH = 600;

test('timestamp maps across the window and wraps to the left edge', () => {
  assert.equal(sweepX(0, WINDOW, WIDTH), 0);
  assert.equal(sweepX(WINDOW / 2, WINDOW, WIDTH), WIDTH / 2);
  assert.equal(sweepX(WINDOW, WINDOW, WIDTH), 0);
  assert.equal(sweepX(WINDOW * 2, WINDOW, WIDTH), 0);

  const justBefore = sweepX(WINDOW - 1, WINDOW, WIDTH);
  assert.ok(justBefore > WIDTH * 0.99 && justBefore < WIDTH);

  // Next lap starts at the left, not past the right edge.
  assert.equal(sweepX(WINDOW + 1, WINDOW, WIDTH), sweepX(1, WINDOW, WIDTH));
  assert.ok(sweepX(WINDOW + 1, WINDOW, WIDTH) < WIDTH * 0.01);
});

test('negative timestamps wrap into the window', () => {
  // -1000 mod 6000 = 5000 → 5000/6000 * 600 = 500
  assert.equal(sweepX(-1000, WINDOW, WIDTH), 500);
});

test('bad window or width does not produce NaN', () => {
  assert.equal(sweepX(100, 0, WIDTH), 0);
  assert.equal(sweepX(100, WINDOW, 0), 0);
  assert.equal(sweepX(Number.NaN, WINDOW, WIDTH), 0);
});

test('samples in front of the cursor are hidden and a full lap falls off', () => {
  const cursor = 7_500;
  assert.equal(sweepX(cursor, WINDOW, WIDTH), 150);

  assert.equal(sampleIsDrawable(cursor, cursor, WINDOW), true);
  assert.equal(sampleIsDrawable(cursor + 1, cursor, WINDOW), false);

  // Previous lap, still on screen, to the right of the cursor.
  assert.equal(sampleIsDrawable(2_000, cursor, WINDOW), true);
  assert.ok(sweepX(2_000, WINDOW, WIDTH) > sweepX(cursor, WINDOW, WIDTH));

  // Exactly one window behind the cursor: the point has wrapped off.
  assert.equal(sampleIsDrawable(cursor - WINDOW, cursor, WINDOW), false);
  assert.equal(sampleIsDrawable(1_000, cursor, WINDOW), false);
});

test('erase gap sits in front of the cursor and does not wrap onto the new trace', () => {
  const cursorX = 150;
  const gap = WIDTH * 0.04;

  assert.equal(isInEraseGap(cursorX, cursorX, gap, WIDTH), false);
  assert.equal(isInEraseGap(cursorX + 2, cursorX, gap, WIDTH), true);
  assert.equal(isInEraseGap(cursorX + gap + 2, cursorX, gap, WIDTH), false);

  // Near the right edge the gap is clipped; it must not blank x near 0.
  assert.equal(isInEraseGap(WIDTH - 2, WIDTH - 10, gap, WIDTH), true);
  assert.equal(isInEraseGap(4, WIDTH - 10, gap, WIDTH), false);
});

test('cursor glides at most maxExtrapolateMs and then pauses', () => {
  assert.equal(cursorTimeMs(null, 0, 1_000, 200), null);
  assert.equal(cursorTimeMs(5_000, 100, 150, 200), 5_050);
  assert.equal(cursorTimeMs(5_000, 100, 10_000, 200), 5_200);
  assert.equal(cursorTimeMs(5_000, 100, 50, 200), 5_000);
});

test('packet timestamps: unix ms, unix seconds, missing, and a backwards reset', () => {
  assert.equal(timestampToMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(timestampToMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(timestampToMs(250), 250);

  const first = resolvePacketStartMs(5_900, 4, 0, null);
  assert.equal(first.reset, false);
  assert.equal(first.startMs, 5_900);

  // Previous packet's last sample is 5900 + 24*4 = 5996. Next packet at 6100
  // is the following lap and must not be treated as a clock reset.
  const next = resolvePacketStartMs(6_100, 4, 0, 5_996);
  assert.equal(next.reset, false);
  assert.equal(next.startMs, 6_100);
  assert.equal(sweepX(next.startMs, WINDOW, WIDTH), sweepX(100, WINDOW, WIDTH));
  assert.ok(sweepX(5_999, WINDOW, WIDTH) > sweepX(next.startMs, WINDOW, WIDTH));

  const back = resolvePacketStartMs(100, 4, 0, 5_000);
  assert.equal(back.reset, true);
  assert.equal(back.startMs, 100);

  const jitter = resolvePacketStartMs(4_980, 4, 0, 5_000);
  assert.equal(jitter.reset, false);
  assert.equal(jitter.startMs, 4_980);

  const missing = resolvePacketStartMs(undefined, 4, 8_000, 1_000);
  assert.equal(missing.reset, false);
  assert.equal(missing.startMs, 1_004);
});

test('ring keeps chronological order across the wrap and drops a late sample', () => {
  const buf = new SweepBuffer(1, 4);
  buf.write(0, 0, 1, 10);
  buf.write(0, 4, 2, 11);
  buf.write(0, 8, 3, 12);
  buf.write(0, 12, 4, 13);
  buf.write(0, 16, 5, 14);

  const ch = buf.channels[0];
  assert.equal(ch.count, 4);
  const order: number[] = [];
  for (let n = 0; n < ch.count; n++) {
    order.push(ch.times[(ch.oldest + n) % ch.capacity]);
  }
  assert.deepEqual(order, [4, 8, 12, 16]);

  buf.write(0, 10, 9, 15);
  assert.equal(buf.lastSampleTimeMs, 16);
  assert.equal(ch.times[(ch.oldest + ch.count - 1) % ch.capacity], 16);

  const offset = firstAtOrAfter(ch.times, ch.oldest, ch.count, ch.capacity, 12);
  assert.equal(ch.times[(ch.oldest + offset) % ch.capacity], 12);
  assert.equal(offset, 2);
});
