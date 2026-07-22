/**
 * Digital ECG paper standards used by The Patch waveform displays.
 *
 * Traditional strip:
 *   Paper speed: 25 mm/s (optional 50 mm/s)
 *   Gain:        10 mm/mV (optional 5 / 20)
 *   Small square (1 mm):  40 ms × 0.1 mV
 *   Large square (5 mm): 200 ms × 0.5 mV
 *   5 large squares = 1 second
 *   Calibration pulse: 1 mV tall × 200 ms wide (10 mm × 5 mm at std settings)
 */

export const ECG_SAMPLE_RATE_HZ = 250;

export const ECG_PAPER_SPEEDS = [25, 50] as const;
export type EcgPaperSpeed = (typeof ECG_PAPER_SPEEDS)[number];

export const ECG_GAINS = [5, 10, 20] as const;
export type EcgGain = (typeof ECG_GAINS)[number];

/** Grid visual intensity for clinical vs fitness layouts. */
export type EcgPaperGridMode = 'off' | 'clinical' | 'subtle';

export const SMALL_SQUARE_MM = 1;
export const LARGE_SQUARE_MM = 5;
export const SMALL_SQUARE_SEC = 0.04;
export const LARGE_SQUARE_SEC = 0.2;
export const SMALL_SQUARE_MV = 0.1;
export const LARGE_SQUARE_MV = 0.5;

/** Calibration mark: 1 mV for 200 ms (one large square wide at 25 mm/s). */
export const CAL_PULSE_MV = 1;
export const CAL_PULSE_SEC = 0.2;

export function mmPerSample(paperSpeedMmPerSec: EcgPaperSpeed): number {
  return paperSpeedMmPerSec / ECG_SAMPLE_RATE_HZ;
}

export function samplesPerMm(paperSpeedMmPerSec: EcgPaperSpeed): number {
  return ECG_SAMPLE_RATE_HZ / paperSpeedMmPerSec;
}

/** Seconds represented by a horizontal pixel span at the given paper scale. */
export function pxToSeconds(
  px: number,
  pxPerMm: number,
  paperSpeedMmPerSec: EcgPaperSpeed
): number {
  return Math.abs(px) / (pxPerMm * paperSpeedMmPerSec);
}

/** Millivolts represented by a vertical pixel span at the given gain scale. */
export function pxToMv(px: number, pxPerMm: number, gainMmPerMv: EcgGain): number {
  return Math.abs(px) / (pxPerMm * gainMmPerMv);
}

export function mvToPx(mv: number, pxPerMm: number, gainMmPerMv: EcgGain): number {
  return mv * gainMmPerMv * pxPerMm;
}

export function secondsToPx(
  seconds: number,
  pxPerMm: number,
  paperSpeedMmPerSec: EcgPaperSpeed
): number {
  return seconds * paperSpeedMmPerSec * pxPerMm;
}

/**
 * Choose px/mm so the visible sample window fills the canvas width while
 * keeping squares square (same mm scale on X and Y).
 */
export function pxPerMmToFitWidth(
  displayWidthPx: number,
  sampleCount: number,
  paperSpeedMmPerSec: EcgPaperSpeed
): number {
  if (displayWidthPx <= 0 || sampleCount < 2) return 4;
  const durationSec = (sampleCount - 1) / ECG_SAMPLE_RATE_HZ;
  const widthMm = durationSec * paperSpeedMmPerSec;
  return displayWidthPx / Math.max(widthMm, 0.001);
}

/** Visible mV span for a canvas height at the current paper scale. */
export function visibleMvRange(
  displayHeightPx: number,
  pxPerMm: number,
  gainMmPerMv: EcgGain
): number {
  return displayHeightPx / (pxPerMm * gainMmPerMv);
}

export function formatDurationMs(seconds: number): string {
  const ms = seconds * 1000;
  if (ms < 1000) return `${ms.toFixed(0)} ms`;
  return `${seconds.toFixed(2)} s`;
}

export function formatMv(mv: number): string {
  if (mv < 0.01) return `${(mv * 1000).toFixed(1)} µV`;
  return `${mv.toFixed(2)} mV`;
}

/** Classic HR shortcut: 300 ÷ large squares between R peaks. */
export function hrFromLargeSquares(largeSquaresBetweenR: number): number | null {
  if (largeSquaresBetweenR <= 0) return null;
  return Math.round(300 / largeSquaresBetweenR);
}
