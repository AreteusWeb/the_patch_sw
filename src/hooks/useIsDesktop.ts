import { useState, useEffect } from 'react';

/**
 * useIsDesktop
 * ------------------------------------------------------------------
 * Detects whether the current viewport should use the desktop layout.
 * Uses `matchMedia` (more efficient than listening to `resize` manually) and
 * updates live if the user resizes the window or rotates the device — useful
 * e.g. when someone uses the app on a tablet and rotates the screen.
 *
 * Breakpoint: 1024px (Tailwind's standard "lg"). Adjust this number if your
 * desktop spec defines a different breakpoint.
 */
const DESKTOP_BREAKPOINT_PX = 1024;

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT_PX}px)`);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);

    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isDesktop;
}
