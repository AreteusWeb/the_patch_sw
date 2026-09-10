/**
 * Passive AI Insights for desktop sidebars.
 *
 * Fires POST /api/coach/insights only when:
 *   (a) the patch first starts delivering real data, or
 *   (b) vitals severity bands change / a new alert is raised
 *       (same thresholds already applied in useWebSocket → store).
 *
 * Does NOT refetch on Normal ↔ Fitness layout switch — one shared result.
 * Server enforces the 75s cooldown (uid+mode).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/appConfig';
import useStore from '../store/useStore';
import {
  getHrvProxyMs,
  getRecoveryScore,
} from '../utils/fitnessMetrics';
import type { Vitals } from '../types';

export type InsightsSeverity = 'normal' | 'watch' | 'alert';
export type InsightsStatus = 'idle' | 'analyzing' | 'ready' | 'error';

export interface CoachInsightsState {
  bullets: string[] | null;
  severity: InsightsSeverity;
  timestamp: string | null;
  status: InsightsStatus;
  /** True while a request is in flight (may already have prior bullets). */
  loading: boolean;
}

/** Reuse store severities (already derived from app alert thresholds). */
function vitalSeverityKey(vitals: Vitals): string {
  return [
    vitals.heartRate.severity,
    vitals.spo2.severity,
    vitals.respirationRate.severity,
  ].join('|');
}

function buildMetricsSnapshot(vitals: Vitals, hasRealData: boolean) {
  const recovery = getRecoveryScore(vitals, hasRealData);
  return {
    heartRate: vitals.heartRate.value,
    spo2: vitals.spo2.value,
    respirationRate: vitals.respirationRate.value,
    temperature: vitals.temperature.value,
    hrvProxyMs: getHrvProxyMs(vitals.heartRate.value, hasRealData),
    recoveryScore: recovery.score,
    hasRealData,
  };
}

const EMPTY: CoachInsightsState = {
  bullets: null,
  severity: 'normal',
  timestamp: null,
  status: 'idle',
  loading: false,
};

export function useCoachInsights(): CoachInsightsState {
  const hasRealData = useStore((s) => s.hasRealData);
  const vitals = useStore((s) => s.vitals);
  const alerts = useStore((s) => s.alerts);
  const desktopLayout = useStore((s) => s.desktopLayout);
  const currentUser = useStore((s) => s.currentUser);

  const [state, setState] = useState<CoachInsightsState>(EMPTY);

  const sessionStartedRef = useRef(false);
  const bandKeyRef = useRef<string | null>(null);
  const topAlertIdRef = useRef<string | null>(null);
  const fetchingRef = useRef(false);
  const pendingRef = useRef(false);
  const modeRef = useRef<'normal' | 'fitness'>('normal');
  const vitalsRef = useRef(vitals);
  const hasRealDataRef = useRef(hasRealData);
  const userRef = useRef(currentUser);

  modeRef.current = desktopLayout === 'fitness' ? 'fitness' : 'normal';
  vitalsRef.current = vitals;
  hasRealDataRef.current = hasRealData;
  userRef.current = currentUser;

  const fetchInsights = useCallback(async () => {
    if (fetchingRef.current) {
      pendingRef.current = true;
      return;
    }
    if (!hasRealDataRef.current) return;

    fetchingRef.current = true;
    setState((prev) => ({
      ...prev,
      loading: true,
      status: prev.bullets ? prev.status : 'analyzing',
    }));

    try {
      const user = userRef.current;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (user && typeof user.getIdToken === 'function') {
        headers.Authorization = `Bearer ${await user.getIdToken()}`;
      }

      const res = await fetch(`${API_BASE}/api/coach/insights`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          mode: modeRef.current,
          metricsSnapshot: buildMetricsSnapshot(
            vitalsRef.current,
            hasRealDataRef.current
          ),
        }),
      });

      if (!res.ok) {
        throw new Error(`insights_http_${res.status}`);
      }

      const data = (await res.json()) as {
        bullets?: unknown;
        severity?: string;
        timestamp?: string;
        source?: string;
        cached?: boolean;
      };

      const bullets = Array.isArray(data.bullets)
        ? data.bullets.map((b) => String(b || '').trim()).filter(Boolean).slice(0, 4)
        : [];
      if (bullets.length === 0) {
        throw new Error('insights_empty');
      }

      const severity: InsightsSeverity =
        data.severity === 'alert' || data.severity === 'watch' || data.severity === 'normal'
          ? data.severity
          : 'normal';

      console.log('[AI Insights]', {
        mode: modeRef.current,
        source: data.source ?? 'unknown',
        cached: Boolean(data.cached),
        severity,
        timestamp: data.timestamp ?? null,
        bullets,
      });

      setState({
        bullets,
        severity,
        timestamp: typeof data.timestamp === 'string' ? data.timestamp : new Date().toISOString(),
        status: 'ready',
        loading: false,
      });
    } catch (err) {
      console.warn('[useCoachInsights] fetch failed:', err);
      setState((prev) => ({
        ...prev,
        loading: false,
        status: prev.bullets ? 'ready' : 'error',
      }));
    } finally {
      fetchingRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        void fetchInsights();
      }
    }
  }, []);

  // Session ended — clear shared insights (next real data = fresh (a)).
  useEffect(() => {
    if (hasRealData) return;
    sessionStartedRef.current = false;
    bandKeyRef.current = null;
    topAlertIdRef.current = null;
    pendingRef.current = false;
    setState(EMPTY);
  }, [hasRealData]);

  // (a) First real data of the stream session.
  useEffect(() => {
    if (!hasRealData || sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    bandKeyRef.current = vitalSeverityKey(vitals);
    topAlertIdRef.current = alerts[0]?.id ?? null;
    setState((prev) => ({ ...prev, status: 'analyzing', loading: true }));
    void fetchInsights();
    // vitals/alerts captured only as baseline for (b); do not re-run (a) on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRealData, fetchInsights]);

  // (b) Significant change: severity band flip or new leading alert.
  useEffect(() => {
    if (!hasRealData || !sessionStartedRef.current) return;

    const nextBand = vitalSeverityKey(vitals);
    const nextAlertId = alerts[0]?.id ?? null;
    const bandChanged =
      bandKeyRef.current != null && nextBand !== bandKeyRef.current;
    const alertChanged =
      nextAlertId != null && nextAlertId !== topAlertIdRef.current;

    bandKeyRef.current = nextBand;
    if (nextAlertId != null) topAlertIdRef.current = nextAlertId;

    if (bandChanged || alertChanged) {
      void fetchInsights();
    }
  }, [hasRealData, vitals, alerts, fetchInsights]);

  return state;
}
