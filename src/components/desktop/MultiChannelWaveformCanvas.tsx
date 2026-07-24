import React, { useCallback, useEffect, useRef, useState } from 'react';

import {

  ECG_SAMPLE_RATE_HZ,

  LARGE_SQUARE_MM,

  SMALL_SQUARE_MM,

  multiLanePaperMinHeightPx,

  pxPerMmToFitWidth,

  type EcgGain,

  type EcgPaperGridMode,

  type EcgPaperSpeed,

} from '../../utils/ecgPaper';

import type { DesktopWaveformChannel } from './desktopWaveformChannels';



interface MultiChannelWaveformCanvasProps {

  waveforms: number[][];

  channels: DesktopWaveformChannel[];

  /** Fixed height in px when fill is false. */

  height?: number;

  /** Expand to fill parent height (parent must be flex-sized). */

  fill?: boolean;

  minHeight?: number;

  paperGrid?: EcgPaperGridMode;

  paperSpeed?: EcgPaperSpeed;

  gain?: EcgGain;

  labelWidth?: number;

}



function drawLanePaperGrid(

  ctx: CanvasRenderingContext2D,

  laneTop: number,

  laneHeight: number,

  traceLeft: number,

  traceWidth: number,

  displayWidth: number,

  midY: number,

  pxPerMm: number,

  paperGrid: EcgPaperGridMode

) {

  const smallPx = SMALL_SQUARE_MM * pxPerMm;

  const largePx = LARGE_SQUARE_MM * pxPerMm;

  const isSubtle = paperGrid === 'subtle';

  const laneBottom = laneTop + laneHeight;



  ctx.save();

  ctx.beginPath();

  ctx.rect(traceLeft, laneTop, traceWidth, laneHeight);

  ctx.clip();



  ctx.strokeStyle = isSubtle ? 'rgba(45, 212, 191, 0.05)' : 'rgba(248, 113, 113, 0.1)';

  ctx.lineWidth = 0.5;

  if (smallPx >= 2) {

    for (let x = traceLeft; x <= traceLeft + traceWidth; x += smallPx) {

      ctx.beginPath();

      ctx.moveTo(x, laneTop);

      ctx.lineTo(x, laneBottom);

      ctx.stroke();

    }

    for (let dy = 0; ; dy += smallPx) {

      const yUp = midY - dy;

      const yDown = midY + dy;

      if (yUp < laneTop && yDown > laneBottom) break;

      if (yUp >= laneTop) {

        ctx.beginPath();

        ctx.moveTo(traceLeft, yUp);

        ctx.lineTo(displayWidth, yUp);

        ctx.stroke();

      }

      if (dy > 0 && yDown <= laneBottom) {

        ctx.beginPath();

        ctx.moveTo(traceLeft, yDown);

        ctx.lineTo(displayWidth, yDown);

        ctx.stroke();

      }

    }

  }



  ctx.strokeStyle = isSubtle ? 'rgba(45, 212, 191, 0.12)' : 'rgba(248, 113, 113, 0.22)';

  ctx.lineWidth = 1;

  for (let x = traceLeft; x <= traceLeft + traceWidth; x += largePx) {

    ctx.beginPath();

    ctx.moveTo(x, laneTop);

    ctx.lineTo(x, laneBottom);

    ctx.stroke();

  }

  for (let dy = 0; ; dy += largePx) {

    const yUp = midY - dy;

    const yDown = midY + dy;

    if (yUp < laneTop && yDown > laneBottom) break;

    if (yUp >= laneTop) {

      ctx.beginPath();

      ctx.moveTo(traceLeft, yUp);

      ctx.lineTo(displayWidth, yUp);

      ctx.stroke();

    }

    if (dy > 0 && yDown <= laneBottom) {

      ctx.beginPath();

      ctx.moveTo(traceLeft, yDown);

      ctx.lineTo(displayWidth, yDown);

      ctx.stroke();

    }

  }



  ctx.restore();

}



/**

 * Renders every waveform channel in stacked lanes on a single canvas —

 * minimal vertical space, distinct color per channel.

 */

const MultiChannelWaveformCanvas: React.FC<MultiChannelWaveformCanvasProps> = ({

  waveforms,

  channels,

  height = 280,

  fill = false,

  minHeight = 320,

  paperGrid = 'off',

  paperSpeed = 25,

  gain = 10,

  labelWidth = 56,

}) => {

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const wrapRef = useRef<HTMLDivElement>(null);

  const usePaper = paperGrid !== 'off';

  const [layoutHeight, setLayoutHeight] = useState<number | null>(null);



  const ecgLaneCount = channels.filter(ch => ch.ecgScale).length;

  const nonEcgLaneCount = channels.length - ecgLaneCount;



  const resolveDisplayHeight = useCallback((rectHeight: number, traceWidth: number, samplesVisible: number) => {

    const base = fill ? Math.max(minHeight, Math.floor(rectHeight)) : Math.max(1, Math.floor(height));

    if (!usePaper || !fill) return base;



    const paperMin = multiLanePaperMinHeightPx(

      traceWidth,

      samplesVisible,

      paperSpeed,

      gain,

      ecgLaneCount,

      nonEcgLaneCount

    );

    return Math.max(base, paperMin);

  }, [fill, minHeight, height, usePaper, paperSpeed, gain, ecgLaneCount, nonEcgLaneCount]);



  const draw = useCallback(() => {

    const canvas = canvasRef.current;

    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (!ctx) return;



    const dpr = window.devicePixelRatio || 1;

    const rect = canvas.getBoundingClientRect();

    const displayWidth = Math.max(1, Math.floor(rect.width));

    const traceLeft = labelWidth + 4;

    const traceWidth = Math.max(1, displayWidth - traceLeft - 4);



    let maxSamples = 2;

    for (const ch of channels) {

      maxSamples = Math.max(maxSamples, waveforms[ch.index]?.length ?? 0);

    }

    const samplesVisible = Math.min(maxSamples, Math.floor(traceWidth));



    const displayHeight = resolveDisplayHeight(rect.height, traceWidth, samplesVisible);

    const pxPerMm = pxPerMmToFitWidth(traceWidth, samplesVisible, paperSpeed);



    if (canvas.width !== displayWidth * dpr || canvas.height !== displayHeight * dpr) {

      canvas.width = displayWidth * dpr;

      canvas.height = displayHeight * dpr;

    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, displayWidth, displayHeight);



    const laneCount = channels.length;

    const laneHeight = displayHeight / laneCount;



    channels.forEach((ch, laneIdx) => {

      const laneTop = laneIdx * laneHeight;

      const padY = 2;

      const drawableH = laneHeight - padY * 2;

      const midY = laneTop + laneHeight / 2;



      if (laneIdx > 0) {

        ctx.strokeStyle = 'rgba(51, 65, 85, 0.55)';

        ctx.lineWidth = 1;

        ctx.beginPath();

        ctx.moveTo(0, laneTop);

        ctx.lineTo(displayWidth, laneTop);

        ctx.stroke();

      }



      if (usePaper && ch.ecgScale) {

        drawLanePaperGrid(

          ctx, laneTop, laneHeight, traceLeft, traceWidth, displayWidth, midY, pxPerMm, paperGrid

        );

      }



      const labelPx = laneHeight >= 36 ? 10 : laneHeight >= 28 ? 9 : 8;

      ctx.fillStyle = ch.color;

      ctx.font = `600 ${labelPx}px ui-monospace, monospace`;

      ctx.textAlign = 'left';

      ctx.textBaseline = 'middle';

      ctx.fillText(ch.label, 6, midY);



      const data = waveforms[ch.index] ?? [];

      if (data.length < 2) return;



      const slice = data.slice(-samplesVisible);

      const step = traceWidth / Math.max(slice.length - 1, 1);



      let min = ch.min;

      let max = ch.max;

      if (usePaper && ch.ecgScale) {

        const halfMv = (drawableH / 2) / (pxPerMm * gain);

        min = -halfMv;

        max = halfMv;

      } else if (!ch.ecgScale) {

        let dataMin = Infinity;

        let dataMax = -Infinity;

        for (const v of slice) {

          if (v < dataMin) dataMin = v;

          if (v > dataMax) dataMax = v;

        }

        if (dataMin === dataMax) return;

        const padding = (dataMax - dataMin) * 0.1 || 0.01;

        min = dataMin - padding;

        max = dataMax + padding;

      }



      const range = max - min || 1;



      ctx.beginPath();

      ctx.strokeStyle = ch.color;

      ctx.lineWidth = ch.ecgScale

        ? (laneHeight >= 32 ? 1.35 : 1.15)

        : (laneHeight >= 32 ? 1.2 : 1);

      ctx.lineJoin = 'round';

      ctx.lineCap = 'round';



      for (let i = 0; i < slice.length; i++) {

        const x = traceLeft + i * step;

        const normalized = (slice[i] - min) / range;

        const y = laneTop + padY + (1 - normalized) * drawableH;

        if (i === 0) ctx.moveTo(x, y);

        else ctx.lineTo(x, y);

      }

      ctx.stroke();



      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';

      ctx.lineWidth = 0.5;

      ctx.beginPath();

      ctx.moveTo(traceLeft, midY);

      ctx.lineTo(displayWidth - 2, midY);

      ctx.stroke();

    });

  }, [

    waveforms, channels, height, fill, minHeight, labelWidth, paperGrid, paperSpeed, gain, usePaper,

    resolveDisplayHeight,

  ]);



  useEffect(() => {

    if (!usePaper || !fill || !wrapRef.current) {

      setLayoutHeight(null);

      return;

    }



    const updateLayoutHeight = () => {

      const el = wrapRef.current;

      if (!el) return;

      const displayWidth = Math.max(1, Math.floor(el.getBoundingClientRect().width));

      const traceWidth = Math.max(1, displayWidth - labelWidth - 4);

      const samplesVisible = Math.max(2, Math.floor(traceWidth));

      const paperMin = multiLanePaperMinHeightPx(

        traceWidth,

        samplesVisible,

        paperSpeed,

        gain,

        ecgLaneCount,

        nonEcgLaneCount

      );

      setLayoutHeight(Math.max(minHeight, paperMin));

    };



    updateLayoutHeight();

    const ro = new ResizeObserver(updateLayoutHeight);

    ro.observe(wrapRef.current);

    return () => ro.disconnect();

  }, [usePaper, fill, minHeight, paperSpeed, gain, ecgLaneCount, nonEcgLaneCount, labelWidth]);



  useEffect(() => {

    draw();

  }, [draw, layoutHeight]);



  useEffect(() => {

    const el = wrapRef.current;

    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(() => draw());

    ro.observe(el);

    return () => ro.disconnect();

  }, [draw]);



  const resolvedHeight = usePaper && fill && layoutHeight != null ? layoutHeight : undefined;



  return (

    <div

      ref={wrapRef}

      className={`relative w-full overflow-hidden bg-[#0a0a0f]${fill && !resolvedHeight ? ' h-full' : ''}`}

      style={

        resolvedHeight != null

          ? { height: resolvedHeight, minHeight: resolvedHeight }

          : fill

            ? { minHeight }

            : { height }

      }

    >

      <canvas

        ref={canvasRef}

        className="w-full block"

        style={resolvedHeight != null ? { height: resolvedHeight } : fill ? { height: '100%' } : { height }}

      />

      {usePaper && (

        <div className="pointer-events-none absolute bottom-1 right-2 text-[8px] text-slate-600 tabular-nums">

          {paperSpeed} mm/s · {gain} mm/mV · per-lead grid

        </div>

      )}

    </div>

  );

};



export default MultiChannelWaveformCanvas;


