/** Standalone electrode placement guide (separate deploy). */
export const ELECTRODE_GUIDE_URL = 'https://electroguide.areteus.com';

/** Navigate in the same tab — continuous flow into the guide app. */
export function openElectrodeGuide(): void {
  window.location.href = ELECTRODE_GUIDE_URL;
}
