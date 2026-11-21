import React, { useRef } from 'react';
import {
  SWEEP_GAP_FRACTION,
  SWEEP_WINDOW_MS,
  clampGapFraction,
  clampSweepWindowMs,
} from '../../lib/sweepGeometry';
import type { SweepTheme, SweepViewConfig } from '../../lib/sweepPaint';
import type { DesktopWaveformChannel } from './desktopWaveformChannels';
import { useResolvedSweepTheme, useSweepPaint } from '../useSweepPaint';

export interface MultiChannelSweepCanvasProps {
  channels: readonly DesktopWaveformChannel[];
  height?: number;
  fill?: boolean;
  minHeight?: number;
  frozen?: boolean;
  theme?: SweepTheme;
  labelWidth?: number;
  windowMs?: number;
  gapFraction?: number;
  grid?: boolean;
}

/**
 * Desktop multi-lead sweep. One canvas, one frame callback, every lead
 * sharing the same cursor so the channels stay aligned.
 * History scrubbing does not use this view — the caller keeps the scrolling
 * canvas while `historyOffset !== 0`.
 */
const MultiChannelSweepCanvas: React.FC<MultiChannelSweepCanvasProps> = React.memo(
  function MultiChannelSweepCanvas({
    channels,
    height = 280,
    fill = false,
    minHeight = 320,
    frozen = false,
    theme = 'dark',
    labelWidth = 56,
    windowMs = SWEEP_WINDOW_MS,
    gapFraction = SWEEP_GAP_FRACTION,
    grid = true,
  }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const resolvedTheme = useResolvedSweepTheme(theme);

    const cfgRef = useRef<SweepViewConfig>({
      lanes: channels,
      labelWidth,
      windowMs,
      gapFraction,
      frozen,
      theme: resolvedTheme,
      grid,
      fill,
      height,
      minHeight,
    });

    const cfg = cfgRef.current;
    cfg.lanes = channels;
    cfg.labelWidth = labelWidth;
    cfg.windowMs = clampSweepWindowMs(windowMs);
    cfg.gapFraction = clampGapFraction(gapFraction);
    cfg.frozen = frozen;
    cfg.theme = resolvedTheme;
    cfg.grid = grid;
    cfg.fill = fill;
    cfg.height = height;
    cfg.minHeight = minHeight;

    useSweepPaint(canvasRef, wrapRef, cfgRef);

    const background = resolvedTheme === 'light' ? '#f8fafc' : '#0a0a0f';

    return (
      <div
        ref={wrapRef}
        className={`relative w-full overflow-hidden${fill ? ' h-full' : ''}`}
        style={fill ? { minHeight, background } : { height, background }}
      >
        <canvas
          ref={canvasRef}
          className="w-full block touch-none"
          style={fill ? { height: '100%' } : { height }}
          role="img"
          aria-label="Sweep waveform, all channels"
        />
      </div>
    );
  },
);

export default MultiChannelSweepCanvas;
