/**
 * Shared realistic waveform sample generators for mock ESP32 scripts.
 * Values are converted to raw ADC so rawToMv() on the frontend yields ~±1 mV ECG.
 *
 * Vitals (HR / Resp / SpO2) change every 15s so scrubbing the desktop timeline
 * shows clearly different past values (elevated → low → moderate).
 */

const ADC_VAL_MAX = 8388607;
const ADC_VAL_MAX_MV = 1200;
const SAMPLE_RATE_HZ = 250;
const PHASE_SECONDS = 15;

const LEAD_SCALE = {
  'Lead I': 1.0,
  'Lead II': 1.0,
  V1: 0.65,
  V2: 0.75,
  V3: 0.85,
  V4: 0.9,
  V5: 0.95,
  V6: 0.8,
};

/** Stepped vitals so rewind shows past Resp/HR/SpO2 changes. */
const VITAL_PHASES = [
  { label: 'baseline',  hr: 70,  resp: 14, spo2: 98 },
  { label: 'elevated',  hr: 105, resp: 24, spo2: 94 },
  { label: 'low',       hr: 52,  resp: 10, spo2: 97 },
  { label: 'moderate',  hr: 82,  resp: 18, spo2: 96 },
];

function vitalsAtTime(tSec) {
  const phase = Math.floor(tSec / PHASE_SECONDS) % VITAL_PHASES.length;
  return { phase, ...VITAL_PHASES[phase] };
}

function mvToRaw(mv) {
  const raw = Math.round((mv / ADC_VAL_MAX_MV) * ADC_VAL_MAX);
  return Math.max(-0x800000, Math.min(0x7fffff, raw));
}

function simEcgMv(t, hr) {
  const phase = (t * hr / 60) % 1;
  let v = 0;
  if (phase < 0.04) v = 0.15 * Math.sin((phase / 0.04) * Math.PI);
  else if (phase < 0.10) v = -0.10 * Math.sin(((phase - 0.04) / 0.06) * Math.PI);
  else if (phase < 0.18) v = 0.85 * Math.sin(((phase - 0.10) / 0.08) * Math.PI);
  else if (phase < 0.22) v = -0.25 * Math.sin(((phase - 0.18) / 0.04) * Math.PI);
  else if (phase < 0.38) v = 0.12 * Math.sin(((phase - 0.22) / 0.16) * Math.PI);
  return v + (Math.random() - 0.5) * 0.012;
}

function simRespMv(t, resp) {
  return Math.sin(t * 2 * Math.PI * resp / 60) * 2.2 + (Math.random() - 0.5) * 0.04;
}

function simPpgMv(t, hr, spo2) {
  const phase = (t * hr / 60) % 1;
  const amplitude = Math.max(0.25, (spo2 - 88) / 10);
  return Math.pow(Math.sin(phase * Math.PI), 2) * amplitude + Math.random() * 0.015;
}

function sampleForChannel(name, sampleIndex) {
  const t = sampleIndex / SAMPLE_RATE_HZ;
  const { hr, resp, spo2 } = vitalsAtTime(t);

  if (name === 'Resp') return mvToRaw(simRespMv(t, resp));
  if (name === 'PPG') return mvToRaw(simPpgMv(t, hr, spo2));

  const scale = LEAD_SCALE[name] ?? 1;
  return mvToRaw(simEcgMv(t, hr) * scale);
}

function getSimVitalsAtSample(sampleIndex) {
  return vitalsAtTime(sampleIndex / SAMPLE_RATE_HZ);
}

module.exports = {
  SAMPLE_RATE_HZ,
  PHASE_SECONDS,
  VITAL_PHASES,
  sampleForChannel,
  getSimVitalsAtSample,
};
