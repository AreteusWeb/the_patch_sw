/**
 * PWA update UX — prompt (not silent auto-reload).
 * On return to foreground, asks the service worker to check for a new version.
 * If Live Voice & Video is active, defers showing the banner until it ends.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import {
  isLiveCoachSessionActive,
  subscribeLiveCoachSessionActive,
} from '../lib/liveCoachActivity';

/** Avoid hammering registration.update() when flipping apps quickly. */
const VISIBILITY_CHECK_MIN_INTERVAL_MS = 30_000;

const PwaUpdateBanner: React.FC = () => {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const lastVisibilityCheckRef = useRef(0);
  const [liveBusy, setLiveBusy] = useState(() => isLiveCoachSessionActive());
  const [dismissed, setDismissed] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) registrationRef.current = registration;
    },
    onRegisterError(error) {
      console.warn('[PWA] service worker registration failed:', error);
    },
  });

  useEffect(() => {
    return subscribeLiveCoachSessionActive(() => {
      setLiveBusy(isLiveCoachSessionActive());
    });
  }, []);

  // New update while Live is on: keep needRefresh, but reset "Después" so
  // the banner can appear once Live ends.
  useEffect(() => {
    if (needRefresh) setDismissed(false);
  }, [needRefresh]);

  const checkForUpdate = useCallback(() => {
    const registration = registrationRef.current;
    if (!registration) return;
    void registration.update().catch((err) => {
      console.warn('[PWA] update check failed:', err);
    });
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastVisibilityCheckRef.current < VISIBILITY_CHECK_MIN_INTERVAL_MS) {
        return;
      }
      lastVisibilityCheckRef.current = now;
      checkForUpdate();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [checkForUpdate]);

  const showBanner = needRefresh && !dismissed && !liveBusy;

  const onUpdateNow = () => {
    void (async () => {
      let reloading = false;
      const reloadOnce = () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
      };

      // Plugin reload often never fires: it waits for workbox "controlling" with
      // isUpdate===true, which is false on the first update in a tab lifetime.
      navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);

      try {
        await updateServiceWorker(true);
        const reg =
          registrationRef.current ??
          (await navigator.serviceWorker.getRegistration());
        // Backup if Workbox messageSkipWaiting did not reach the waiting worker.
        reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
      } catch (err) {
        console.warn('[PWA] failed to apply update:', err);
      }

      // Always reload shortly after skipWaiting so the new precache is used.
      window.setTimeout(reloadOnce, 400);
    })();
  };

  const onLater = () => {
    setDismissed(true);
    setNeedRefresh(false);
  };

  if (!showBanner) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 right-4 z-[100] mx-auto max-w-md pointer-events-auto"
    >
      <div className="rounded-xl border border-teal-500/40 bg-slate-950/95 px-4 py-3 shadow-lg backdrop-blur-sm">
        <p className="text-sm font-medium text-white">
          An update is available
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Reload to use the new version. You can do it later if you&apos;re in
          the middle of something.
        </p>
        <div className="mt-3 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onLater}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 transition-colors"
          >
            Later
          </button>
          <button
            type="button"
            onClick={onUpdateNow}
            className="rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-teal-400 transition-colors"
          >
            Update now
          </button>
        </div>
      </div>
    </div>
  );
};

export default PwaUpdateBanner;
