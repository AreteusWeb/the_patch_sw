/**
 * One requestAnimationFrame loop shared by every sweep canvas.
 * Painters are invoked with the frame timestamp (same clock as performance.now()).
 * Unsubscribing the last painter cancels the loop so a hidden chart does not tick.
 */

type SweepPainter = (now: number) => void;

const painters = new Set<SweepPainter>();
let rafId = 0;

function frame(now: number) {
  rafId = requestAnimationFrame(frame);
  painters.forEach(paint => {
    paint(now);
  });
}

export function subscribeSweepFrame(paint: SweepPainter): () => void {
  painters.add(paint);
  if (painters.size === 1) rafId = requestAnimationFrame(frame);
  return () => {
    painters.delete(paint);
    if (painters.size === 0) cancelAnimationFrame(rafId);
  };
}
