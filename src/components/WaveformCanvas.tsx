import React, { useRef, useEffect } from 'react';

/**
 * Properties for the WaveformCanvas component.
 */
interface WaveformCanvasProps {
  /** Array of numerical samples to plot. */
  data: number[];
  /** Color theme for drawing the waveform trace. */
  color?: string;
  /** Width of the drawn trace line. */
  lineWidth?: number;
  /** Fixed height of the canvas viewport. */
  height?: number;
  /** Minimum value boundary if autoScale is disabled. */
  min?: number;
  /** Maximum value boundary if autoScale is disabled. */
  max?: number;
  /** Label tag printed on the top-left of the viewport. */
  label?: string;
  /** If true, draws grid mesh lines on the background. */
  gridLines?: boolean;
  /** If true, dynamically calculates vertical bounds based on input sample values. */
  autoScale?: boolean; // new prop — default true
}

/**
 * WaveformCanvas Component.
 * Custom high-performance HTML5 Canvas-based renderer for real-time biological signals.
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
  autoScale = true, // autoscale active by default
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const displayWidth = Math.floor(rect.width);
    const displayHeight = Math.floor(height);

    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
      ctx.scale(dpr, dpr);
    }

    const draw = () => {
      ctx.clearRect(0, 0, displayWidth, displayHeight);

      if (gridLines) {
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

      if (data.length < 2) return;

      // ── Autoscale: calculate min/max of the current data ──────────────────
      let effectiveMin = min;
      let effectiveMax = max;

      if (autoScale) {
        let dataMin = Infinity;
        let dataMax = -Infinity;
        for (let i = 0; i < data.length; i++) {
          if (data[i] < dataMin) dataMin = data[i];
          if (data[i] > dataMax) dataMax = data[i];
        }

        // If all values are equal (flat signal), do not draw
        if (dataMin === dataMax) return;

        // Add 5% padding to top and bottom to avoid clipping the waveform
        const padding = (dataMax - dataMin) * 0.05;
        effectiveMin = dataMin - padding;
        effectiveMax = dataMax + padding;
      }
      // ─────────────────────────────────────────────────────────────────────

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      const step = displayWidth / (data.length - 1);

      for (let i = 0; i < data.length; i++) {
        const x = i * step;
        const normalized = (data[i] - effectiveMin) / (effectiveMax - effectiveMin);
        const y = displayHeight - normalized * displayHeight;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      if (label) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '10px Roboto Mono, monospace';
        ctx.fillText(label, 8, 14);
      }
    };

    draw();
  }, [data, color, lineWidth, height, min, max, label, gridLines, autoScale]);

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      <canvas
        ref={canvasRef}
        className="w-full block"
        style={{ height }}
      />
    </div>
  );
};

export default WaveformCanvas;
