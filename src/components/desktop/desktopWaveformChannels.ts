import { CH_RANGES, LEADS } from '../../hooks/useWebSocket';

export interface DesktopWaveformChannel {
  label: string;
  index: number;
  color: string;
  min: number;
  max: number;
  /** Use fixed ECG mV scaling when paper grid is on. */
  ecgScale?: boolean;
}

const ECG_COLORS = [
  '#2dd4bf', // Lead I
  '#14b8a6', // Lead II
  '#5eead4', // V1
  '#22d3ee', // V2
  '#38bdf8', // V3
  '#60a5fa', // V4
  '#818cf8', // V5
  '#a78bfa', // V6
] as const;

/** All live device channels on one compact strip (8 ECG + Resp + PPG). */
export const DESKTOP_WAVEFORM_CHANNELS: DesktopWaveformChannel[] = [
  ...LEADS.map((label, i) => ({
    label,
    index: i,
    color: ECG_COLORS[i],
    min: CH_RANGES[i][0],
    max: CH_RANGES[i][1],
    ecgScale: true,
  })),
  {
    label: 'Resp',
    index: 8,
    color: '#34d399',
    min: CH_RANGES[8][0],
    max: CH_RANGES[8][1],
  },
  {
    label: 'SpO2 Pleth',
    index: 9,
    color: '#f472b6',
    min: CH_RANGES[9][0],
    max: CH_RANGES[9][1],
  },
];
