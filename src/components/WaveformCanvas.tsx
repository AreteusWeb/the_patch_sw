import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CAL_PULSE_MV,
  CAL_PULSE_SEC,
  ECG_SAMPLE_RATE_HZ,
  LARGE_SQUARE_MM,
  SMALL_SQUARE_MM,
  formatDurationMs,
  formatMv,
  mmPerSample,
  mvToPx,
  pxToMv,
  pxToSeconds,
  secondsToPx,
  type EcgGain,
  type EcgPaperGridMode,
  type EcgPaperSpeed,
} from '../utils/ecgPaper';

interface WaveformCanvasProps {
  data: number[];
  color?: string;
  lineWidth?: number;
  height?: number;
  min?: number;
  max?: number;
  label?: string;
  /** Legacy decorative grid (non-paper). Ignored when paperGrid !== 'off'. */
  gridLines?: boolean;
  autoScale?: boolean;
  /** Digital ECG paper grid. Default 'off' preserves existing callers. */
  paperGrid?: EcgPaperGridMode;
  paperSpeed?: EcgPaperSpeed;
  gain?: EcgGain;
  /** Draw classic 1 mV × 200 ms calibration pulse at the left. */
  showCalibration?: boolean;
  /** Enable click-drag time/voltage measurement. */
  measureEnabled?: boolean;
  sampleRateHz?: number;
}

interface MeasureState {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * High-performance waveform renderer with optional ECG-paper grid,
 * calibration mark, and interactive Δt / ΔV measurement.
 */
const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  data,
  color = '#00f2ff',
  lineWidth = 1.5,
  height = 100,
  min = -1,
  max = 1,
  label,
  gridLines = true,
  autoScale = true,
  paperGrid = 'off',
  paperSpeed = 25,
  gain = 10,
  showCalibration = false,
  measureEnabled = false,
  sampleRateHz = ECG_SAMPLE_RATE_HZ,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [measure, setMeasure] = useState<MeasureState | null>(null);
  const dragging = useRef(false);
  const scaleRef = useRef({ pxPerMm: 4, baselineY: height / 2 });

  const usePaper = paperGrid !== 'off';

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const displayWidth = Math.max(1, Math.floor(rect.width));
    const displayHeight = Math.max(1, Math.floor(height));

    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const sampleCount = Math.max(data.length, 2);
    // Reserve space for the calibration pulse so the trace still fits the strip.
    const calReserveMm = usePaper && showCalibration
      ? CAL_PULSE_SEC * paperSpeed + 2
      : 0;
    const pxPerMm = usePaper
      ? (() => {
          const durationSec = (sampleCount - 1) / ECG_SAMPLE_RATE_HZ;
          const widthMm = durationSec * paperSpeed + calReserveMm;
          return displayWidth / Math.max(widthMm, 0.001);
        })()
      : 4;
    const baselineY = displayHeight / 2;
    scaleRef.current = { pxPerMm, baselineY };

    // ── Grid ───────────────────────────────────────────────────────────────
    if (usePaper) {
      const smallPx = SMALL_SQUARE_MM * pxPerMm;
      const largePx = LARGE_SQUARE_MM * pxPerMm;
      const isSubtle = paperGrid === 'subtle';

      // Small squares
      ctx.strokeStyle = isSubtle ? 'rgba(45, 212, 191, 0.06)' : 'rgba(248, 113, 113, 0.12)';
      ctx.lineWidth = 0.5;
      if (smallPx >= 3) {
        for (let x = 0; x <= displayWidth; x += smallPx) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, displayHeight);
          ctx.stroke();
        }
        for (let y = 0; y <= displayHeight; y += smallPx) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(displayWidth, y);
          ctx.stroke();
        }
      }

      // Large squares (bolder)
      ctx.strokeStyle = isSubtle ? 'rgba(45, 212, 191, 0.14)' : 'rgba(248, 113, 113, 0.28)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= displayWidth; x += largePx) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, displayHeight);
        ctx.stroke();
      }
      for (let y = 0; y <= displayHeight; y += largePx) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(displayWidth, y);
        ctx.stroke();
      }
    } else if (gridLines) {
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const y = (i / 4) * displayHeight;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(displayWidth, y);
        ctx.stroke();
      }
      for (let i = 0; i < displayWidth; i += 50) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, displayHeight);
        ctx.stroke();
      }
    }

    // ── Calibration pulse (paper mode) ─────────────────────────────────────
    const calWidthPx = usePaper && showCalibration
      ? secondsToPx(CAL_PULSE_SEC, pxPerMm, paperSpeed)
      : 0;
    const calHeightPx = usePaper && showCalibration
      ? mvToPx(CAL_PULSE_MV, pxPerMm, gain)
      : 0;

    if (usePaper && showCalibration && calWidthPx > 2 && calHeightPx > 2) {
      const calX = 4;
      const calTop = baselineY - calHeightPx;
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(calX, baselineY);
      ctx.lineTo(calX, calTop);
      ctx.lineTo(calX + calWidthPx, calTop);
      ctx.lineTo(calX + calWidthPx, baselineY);
      ctx.stroke();

      ctx.fillStyle = 'rgba(148, 163, 184, 0.7)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.fillText('1 mV', calX + 2, Math.max(10, calTop - 3));
    }

    if (data.length < 2) return;

    // ── Trace ──────────────────────────────────────────────────────────────
    let effectiveMin = min;
    let effectiveMax = max;
    const traceOffsetX = usePaper && showCalibration ? calWidthPx + 8 : 0;

    if (usePaper) {
      // Fixed mV scale from gain — squares stay accurate (no autoscale).
      const halfMv = (displayHeight / 2) / (pxPerMm * gain);
      effectiveMin = -halfMv;
      effectiveMax = halfMv;
    } else if (autoScale) {
      let dataMin = Infinity;
      let dataMax = -Infinity;
      for (let i = 0; i < data.length; i++) {
        if (data[i] < dataMin) dataMin = data[i];
        if (data[i] > dataMax) dataMax = data[i];
      }
      if (dataMin === dataMax) return;
      const padding = (dataMax - dataMin) * 0.05;
      effectiveMin = dataMin - padding;
      effectiveMax = dataMax + padding;
    }

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (usePaper) {
      // Paper-speed mapping: each sample advances a fixed mm distance.
      const step = mmPerSample(paperSpeed) * pxPerMm;
      const drawWidth = displayWidth - traceOffsetX;
      // Show the most recent window that fits the drawable width.
      const samplesVisible = Math.min(data.length, Math.floor(drawWidth / step) + 1);
      const startIdx = Math.max(0, data.length - samplesVisible);

      for (let i = startIdx; i < data.length; i++) {
        const x = traceOffsetX + (i - startIdx) * step;
        const normalized = (data[i] - effectiveMin) / (effectiveMax - effectiveMin);
        const y = displayHeight - normalized * displayHeight;
        if (i === startIdx) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    } else {
      const step = displayWidth / (data.length - 1);
      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const normalized = (data[i] - effectiveMin) / (effectiveMax - effectiveMin);
        const y = displayHeight - normalized * displayHeight;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    if (label) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px Roboto Mono, monospace';
      ctx.fillText(label, 8, 14);
    }

    // ── Measurement overlay ────────────────────────────────────────────────
    if (measure && measureEnabled) {
      const { x0, y0, x1, y1 } = measure;
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      const w = Math.abs(x1 - x0);
      const h = Math.abs(y1 - y0);

      ctx.fillStyle = 'rgba(45, 212, 191, 0.08)';
      ctx.fillRect(left, top, w, h);
      ctx.strokeStyle = 'rgba(45, 212, 191, 0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(left, top, w, h);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.setLineDash([]);

      const dt = pxToSeconds(w, pxPerMm, paperSpeed);
      const dv = pxToMv(h, pxPerMm, gain);
      const text = `${formatDurationMs(dt)}  ·  ${formatMv(dv)}`;
      ctx.font = 'bold 11px ui-monospace, monospace';
      const tw = ctx.measureText(text).width;
      const tx = Math.min(left, displayWidth - tw - 12);
      const ty = Math.max(14, top - 6);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.fillRect(tx - 4, ty - 11, tw + 8, 16);
      ctx.fillStyle = '#5eead4';
      ctx.fillText(text, tx, ty);
    }
  }, [
    data, color, lineWidth, height, min, max, label, gridLines, autoScale,
    paperGrid, paperSpeed, gain, showCalibration, measureEnabled, measure, usePaper,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  const toLocal = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!measureEnabled || !usePaper) return;
    const p = toLocal(e);
    dragging.current = true;
    setMeasure({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !measure) return;
    const p = toLocal(e);
    setMeasure({ ...measure, x1: p.x, y1: p.y });
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <div
      ref={wrapRef}
      className="relative w-full overflow-hidden"
      style={{ height, cursor: measureEnabled && usePaper ? 'crosshair' : undefined }}
    >
      <canvas
        ref={canvasRef}
        className="w-full block touch-none"
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      />
      {usePaper && (
        <div className="pointer-events-none absolute bottom-1 right-2 text-[8px] text-slate-600 tabular-nums">
          {paperSpeed} mm/s · {gain} mm/mV · {sampleRateHz} Hz
        </div>
      )}
    </div>
  );
};

export default WaveformCanvas;
