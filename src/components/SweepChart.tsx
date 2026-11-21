import React, { useRef } from 'react';
import {
  SWEEP_GAP_FRACTION,
  SWEEP_WINDOW_MS,
  clampGapFraction,
  clampSweepWindowMs,
} from '../lib/sweepGeometry';
import type { SweepLaneView, SweepTheme, SweepViewConfig } from '../lib/sweepPaint';
import { useResolvedSweepTheme, useSweepPaint } from './useSweepPaint';

export interface SweepChartProps {
  /** Slot in the sweep feed (same index as the waveform rings). */
  channel: number;
  height?: number;
  color?: string;
  min?: number;
  max?: number;
  lineWidth?: number;
  label?: string;
  grid?: boolean;
  /** STALE / disconnected — trace stays, cursor does not glide. */
  frozen?: boolean;
  theme?: SweepTheme;
  /** On-screen window. Clamped to 1–16 s. Default 6 s. */
  windowMs?: number;
  /** Blank band in front of the cursor, fraction of the width. Default 0.04. */
  gapFraction?: number;
}

/**
 * One live trace in sweep mode. Samples live in `sweepFeed` (a ref-like ring);
 * this component does not read the scrolling `waveforms` arrays and does not
 * set state on each frame.
 *
 * Cursor: see `sweepGeometry.ts`. With no samples it sits at the left edge.
 * After the first sample it follows data time and pauses when the stream
 * goes quiet, so a disconnect or a background tab does not erase the strip.
 */
const SweepChart: React.FC<SweepChartProps> = React.memo(function SweepChart({
  channel,
  height = 100,
  color = '#2dd4bf',
  min = -2,
  max = 2,
  lineWidth = 1.5,
  label,
  grid = false,
  frozen = false,
  theme = 'dark',
  windowMs = SWEEP_WINDOW_MS,
  gapFraction = SWEEP_GAP_FRACTION,
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const resolvedTheme = useResolvedSweepTheme(theme);

  const laneRef = useRef<SweepLaneView>({ index: channel, color, min, max, label, lineWidth });
  const lanesRef = useRef<SweepLaneView[]>([laneRef.current]);
  const cfgRef = useRef<SweepViewConfig>({
    lanes: lanesRef.current,
    labelWidth: 0,
    windowMs,
    gapFraction,
    frozen,
    theme: resolvedTheme,
    grid,
    fill: false,
    height,
    minHeight: height,
  });

  const lane = laneRef.current;
  lane.index = channel;
  lane.color = color;
  lane.min = min;
  lane.max = max;
  lane.label = label;
  lane.lineWidth = lineWidth;

  const cfg = cfgRef.current;
  cfg.windowMs = clampSweepWindowMs(windowMs);
  cfg.gapFraction = clampGapFraction(gapFraction);
  cfg.frozen = frozen;
  cfg.theme = resolvedTheme;
  cfg.grid = grid;
  cfg.height = height;
  cfg.minHeight = height;

  useSweepPaint(canvasRef, wrapRef, cfgRef);

  const background = resolvedTheme === 'light' ? '#f8fafc' : '#0a0a0f';

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden"
      style={{ height, background }}
    >
      <canvas
        ref={canvasRef}
        className="w-full block touch-none"
        style={{ height }}
        role="img"
        aria-label={label ? `${label} sweep waveform` : 'Sweep waveform'}
      />
    </div>
  );
});

export default SweepChart;
