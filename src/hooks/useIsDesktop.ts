import { useState } from 'react';

/**
 * useIsDesktop
 * ------------------------------------------------------------------
 * Chooses DesktopApp vs MobileApp by device type, NOT viewport width.
 * Shrinking a desktop browser window (half-screen, etc.) keeps the
 * desktop layout; MobileApp only shows on phones / tablets.
 */
function isMobileOrTabletDevice(): boolean {
  const ua = navigator.userAgent || '';

  if (/Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }

  // iPad (classic UA) and iPadOS (reports as MacIntel + touch)
  if (/iPad/i.test(ua)) return true;
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
    return true;
  }

  // Android tablets / other touch tablets without "Mobile" in the UA
  if (/\bTablet\b/i.test(ua)) return true;

  return false;
}

export function useIsDesktop(): boolean {
  // Device class doesn't change with window resize — no media-query listener.
  const [isDesktop] = useState(() => !isMobileOrTabletDevice());
  return isDesktop;
}
