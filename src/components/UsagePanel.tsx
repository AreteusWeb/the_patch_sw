import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import useStore from '../store/useStore';
import { API_BASE } from '../lib/appConfig';
import { cn } from '../utils/cn';

type UsageBucket = {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
};

type UsageResponse = {
  periodStart: string;
  resetsAt: string;
  plan: string;
  limitUsd: number | null;
  total: UsageBucket;
  byProvider: {
    openai: UsageBucket;
    gemini: UsageBucket;
    deepseek: UsageBucket;
  };
};

function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n > 0 && n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function formatReset(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Compact usage summary for the standalone AI Agent (General spend this period).
 */
export default function UsagePanel({ className }: { className?: string }) {
  const currentUser = useStore((s) => s.currentUser);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentUser || typeof currentUser.getIdToken !== 'function') {
        setLoading(false);
        setError('Sign in required');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = await currentUser.getIdToken();
        const res = await fetch(`${API_BASE}/api/usage`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            body?.error === 'unauthorized'
              ? 'Session expired'
              : 'Could not load usage'
          );
        }
        if (!cancelled) setData(body as UsageResponse);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load usage');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser]);

  const spent = data?.total?.costUsd ?? 0;
  const limit = data?.limitUsd;
  const pct =
    limit != null && limit > 0
      ? Math.min(100, Math.round((spent / limit) * 100))
      : null;

  return (
    <div
      className={cn(
        'rounded-xl border border-white/5 bg-black/40 px-3 py-2.5',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6B7280]">
          Usage
        </p>
        {loading && <Loader2 size={12} className="animate-spin text-[#6B7280]" />}
      </div>

      {error && (
        <p className="text-[11px] text-rose-400/90 leading-snug">{error}</p>
      )}

      {!error && !loading && data && (
        <>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[15px] font-semibold text-[#F5F5F5] tabular-nums">
              {formatUsd(spent)}
              {limit != null && (
                <span className="text-[11px] font-medium text-[#6B7280]">
                  {' '}
                  / {formatUsd(limit)}
                </span>
              )}
            </p>
            <p className="text-[9px] text-[#6B7280] uppercase tracking-wider">
              {data.plan || 'free'}
            </p>
          </div>

          {pct != null && (
            <div className="mt-2 h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-[width]',
                  pct >= 90 ? 'bg-rose-400' : 'bg-teal-500/80'
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          )}

          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {(
              [
                ['OpenAI', data.byProvider.openai],
                ['Gemini', data.byProvider.gemini],
                ['DeepSeek', data.byProvider.deepseek],
              ] as const
            ).map(([label, bucket]) => (
              <div key={label} className="min-w-0">
                <p className="text-[8px] uppercase tracking-wider text-[#6B7280] truncate">
                  {label}
                </p>
                <p className="text-[11px] text-[#A0A0A8] tabular-nums truncate">
                  {formatUsd(bucket?.costUsd)}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-2 text-[9px] text-[#6B7280] leading-snug">
            Resets {formatReset(data.resetsAt)}
          </p>
        </>
      )}
    </div>
  );
}
