/**
 * Shared motion presets — Apple-like easing, low bounce.
 * Prefer these over punchy springs for sheets / drawers.
 */

/** Signature iOS / macOS curve */
export const appleEase = [0.32, 0.72, 0, 1] as const;

export const fadeTransition = {
  duration: 0.32,
  ease: appleEase,
};

/** Full-screen sheet (mobile coach): soft rise + scale, not a hard slide */
export const sheetMotion = {
  initial: { opacity: 0, y: 28, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 16, scale: 0.985 },
  transition: { duration: 0.42, ease: appleEase },
};

/** Side drawers (menu, alerts, profile) */
export const drawerMotion = {
  initial: { x: '100%', opacity: 0.85 },
  animate: { x: 0, opacity: 1 },
  exit: { x: '18%', opacity: 0 },
  transition: { duration: 0.4, ease: appleEase },
};

export const backdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.28, ease: appleEase },
};
