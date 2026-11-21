/**
 * Imperative sweep painter. Call from the shared rAF loop.
 * No allocations: colors, lane objects and the sample rings are owned by the caller.
 */

import type { SweepBuffer } from './sweepFeed';
import {
  SWEEP_GAP_BREAK_MS,
  SWEEP_GAP_FRACTION,
  SWEEP_MAX_EXTRAPOLATE_MS,
  SWEEP_WINDOW_MS,
  clampGapFraction,
  clampSweepWindowMs,
  cursorTimeMs,
  firstAtOrAfter,
  isInEraseGap,
  sampleIsDrawable,
  sweepX,
} from './sweepGeometry';

export type SweepTheme = 'dark' | 'light' | 'auto';

export interface SweepLaneView {
  index: number;
  color: string;
  min: number;
  max: number;
  label?: string;
  lineWidth?: number;
}

export interface SweepViewConfig {
  lanes: readonly SweepLaneView[];
  labelWidth: number;
  windowMs: number;
  gapFraction: number;
  frozen: boolean;
  /** Already resolved — paint does not touch matchMedia. */
  theme: 'dark' | 'light';
  grid: boolean;
  fill: boolean;
  height: number;
  minHeight: number;
}

interface SweepPalette {
  background: string;
  grid: string;
  cursor: string;
  label: string;
  frozen: string;
  hatch: string;
  separator: string;
  baseline: string;
}

const DARK: SweepPalette = {
  background: '#0a0a0f',
  grid: 'rgba(148, 163, 184, 0.16)',
  // Dim leading edge. The blank gap is the bar; on a near-black strip a
  // pure-black stroke would vanish, so the edge is a quiet slate line.
  cursor: 'rgba(226, 232, 240, 0.38)',
  label: 'rgba(148, 163, 184, 0.9)',
  frozen: 'rgba(148, 163, 184, 0.75)',
  hatch: 'rgba(148, 163, 184, 0.07)',
  separator: 'rgba(51, 65, 85, 0.55)',
  baseline: 'rgba(148, 163, 184, 0.14)',
};

const LIGHT: SweepPalette = {
  background: '#f8fafc',
  grid: 'rgba(100, 116, 139, 0.28)',
  cursor: 'rgba(15, 23, 42, 0.55)',
  label: 'rgba(51, 65, 85, 0.88)',
  frozen: 'rgba(71, 85, 105, 0.8)',
  hatch: 'rgba(15, 23, 42, 0.05)',
  separator: 'rgba(203, 213, 225, 0.95)',
  baseline: 'rgba(100, 116, 139, 0.28)',
};

const FONT_10 = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
const FONT_8 = '600 8px ui-monospace, SFMono-Regular, Menlo, monospace';

export function paintSweepFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  buffer: SweepBuffer,
  cfg: SweepViewConfig,
  cssWidth: number,
  cssHeight: number,
  now: number,
) {
  if (!(cssWidth >= 2) || !(cssHeight >= 2)) return;

  const dpr = window.devicePixelRatio || 1;
  const bitmapW = Math.max(1, Math.round(cssWidth * dpr));
  const bitmapH = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== bitmapW || canvas.height !== bitmapH) {
    canvas.width = bitmapW;
    canvas.height = bitmapH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const palette = cfg.theme === 'light' ? LIGHT : DARK;
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const labelWidth = cfg.labelWidth > 0 ? cfg.labelWidth : 0;
  const traceLeft = labelWidth > 0 ? labelWidth + 4 : 0;
  const traceWidth = Math.max(1, cssWidth - traceLeft - (labelWidth > 0 ? 4 : 0));
  const windowMs = clampSweepWindowMs(
    Number.isFinite(cfg.windowMs) ? cfg.windowMs : SWEEP_WINDOW_MS,
  );
  const gapPx = traceWidth * clampGapFraction(
    Number.isFinite(cfg.gapFraction) ? cfg.gapFraction : SWEEP_GAP_FRACTION,
  );

  const cursorTime = cursorTimeMs(
    buffer.lastSampleTimeMs,
    buffer.lastRecvPerfMs,
    now,
    cfg.frozen ? 0 : SWEEP_MAX_EXTRAPOLATE_MS,
  );
  const cursorX = cursorTime == null ? 0 : sweepX(cursorTime, windowMs, traceWidth);

  const lanes = cfg.lanes;
  const laneCount = lanes.length || 1;
  const laneH = cssHeight / laneCount;

  if (cfg.grid && traceWidth > 40) {
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 0.5;
    const seconds = windowMs / 1000;
    const pxPerSec = traceWidth / seconds;
    if (pxPerSec >= 8) {
      for (let s = 0; s <= seconds; s++) {
        const x = traceLeft + s * pxPerSec;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssHeight);
        ctx.stroke();
      }
    }
  }

  for (let laneIdx = 0; laneIdx < lanes.length; laneIdx++) {
    const lane = lanes[laneIdx];
    const top = laneIdx * laneH;
    const midY = top + laneH / 2;
    const pad = 2;
    const drawableH = Math.max(1, laneH - pad * 2);
    const drawTop = top + pad;

    if (laneIdx > 0) {
      ctx.strokeStyle = palette.separator;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, top);
      ctx.lineTo(cssWidth, top);
      ctx.stroke();
    }

    ctx.strokeStyle = palette.baseline;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(traceLeft, midY);
    ctx.lineTo(traceLeft + traceWidth, midY);
    ctx.stroke();

    if (lane.label && labelWidth > 0) {
      ctx.fillStyle = cfg.frozen ? palette.frozen : lane.color;
      ctx.font = laneH >= 28 ? FONT_10 : FONT_8;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(lane.label, 6, midY);
    }

    const ch = buffer.channels[lane.index];
    if (!ch || ch.count === 0 || cursorTime == null) continue;

    const min = lane.min;
    const max = lane.max;
    const range = max - min || 1;
    const minTime = cursorTime - windowMs;
    const start = firstAtOrAfter(ch.times, ch.oldest, ch.count, ch.capacity, minTime);

    ctx.beginPath();
    ctx.strokeStyle = cfg.frozen ? palette.frozen : lane.color;
    ctx.globalAlpha = cfg.frozen ? 0.55 : 1;
    ctx.lineWidth = lane.lineWidth && lane.lineWidth > 0 ? lane.lineWidth : 1.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let pen = false;
    let prevX = 0;
    let prevT = 0;

    for (let n = start; n < ch.count; n++) {
      const idx = (ch.oldest + n) % ch.capacity;
      const t = ch.times[idx];
      if (t > cursorTime) break;
      if (!sampleIsDrawable(t, cursorTime, windowMs)) {
        if (pen) {
          ctx.stroke();
          ctx.beginPath();
          pen = false;
        }
        continue;
      }
      const xRel = sweepX(t, windowMs, traceWidth);
      if (isInEraseGap(xRel, cursorX, gapPx, traceWidth)) {
        if (pen) {
          ctx.stroke();
          ctx.beginPath();
          pen = false;
        }
        continue;
      }

      let norm = (ch.values[idx] - min) / range;
      if (norm < 0) norm = 0;
      else if (norm > 1) norm = 1;
      const x = traceLeft + xRel;
      const y = drawTop + (1 - norm) * drawableH;

      if (!pen) {
        ctx.moveTo(x, y);
        pen = true;
      } else if (xRel + 0.5 < prevX || t - prevT > SWEEP_GAP_BREAK_MS) {
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
      prevX = xRel;
      prevT = t;
    }
    if (pen) ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (cfg.frozen) {
    ctx.strokeStyle = palette.hatch;
    ctx.lineWidth = 1;
    const step = 12;
    for (let x = -cssHeight; x < cssWidth + cssHeight; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + cssHeight, cssHeight);
      ctx.stroke();
    }
  }

  const cursorScreen = traceLeft + cursorX;
  ctx.beginPath();
  ctx.strokeStyle = palette.cursor;
  ctx.lineWidth = 1.25;
  ctx.moveTo(cursorScreen, 0);
  ctx.lineTo(cursorScreen, cssHeight);
  ctx.stroke();
}
