import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { sweepFeed } from '../lib/sweepFeed';
import { subscribeSweepFrame } from '../lib/sweepFrame';
import {
  paintSweepFrame,
  type SweepTheme,
  type SweepViewConfig,
} from '../lib/sweepPaint';

export function useResolvedSweepTheme(theme: SweepTheme): 'dark' | 'light' {
  const [osTheme, setOsTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    if (theme !== 'auto') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => setOsTheme(mq.matches ? 'light' : 'dark');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  if (theme === 'light' || theme === 'dark') return theme;
  return osTheme;
}

/**
 * Keeps a 2D context and a single shared animation frame.
 * Size is measured on resize, not on every frame, so layout stays off the hot path.
 */
export function useSweepPaint(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  wrapRef: RefObject<HTMLDivElement | null>,
  cfgRef: RefObject<SweepViewConfig>,
) {
  const measureRef = useRef<() => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext('2d', { alpha: false }) ?? canvas.getContext('2d');
    if (!ctx) return;

    const size = { w: 1, h: 1 };
    const measure = () => {
      const rect = wrap.getBoundingClientRect();
      const cfg = cfgRef.current;
      size.w = Math.max(1, rect.width);
      size.h = cfg.fill
        ? Math.max(cfg.minHeight, Math.floor(rect.height) || cfg.minHeight)
        : Math.max(1, cfg.height);
    };
    measureRef.current = measure;
    measure();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(wrap);

    const onVisible = () => {
      if (document.visibilityState === 'visible') measure();
    };
    document.addEventListener('visibilitychange', onVisible);

    const unsub = subscribeSweepFrame(now => {
      paintSweepFrame(ctx, canvas, sweepFeed, cfgRef.current, size.w, size.h, now);
    });

    return () => {
      ro?.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      measureRef.current = () => {};
      unsub();
    };
  }, [canvasRef, cfgRef, wrapRef]);

  // Height/theme commits are rare (the chart is memoized). Remeasure then,
  // because a style-only height change can land before ResizeObserver.
  useLayoutEffect(() => {
    measureRef.current();
  });

  return measureRef;
}
