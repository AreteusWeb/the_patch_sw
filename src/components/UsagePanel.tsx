import React, { useEffect, useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
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
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Compact usage summary for the standalone AI Agent (General spend this period).
 * Desktop: fixed card on the right (out of chat flow). Mobile: one-line expand.
 */
export default function UsagePanel({ className }: { className?: string }) {
  const currentUser = useStore((s) => s.currentUser);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

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

  const spentLabel =
    limit != null ? `${formatUsd(spent)} / ${formatUsd(limit)}` : formatUsd(spent);

  const providerRows = data
    ? ([
        ['OpenAI', data.byProvider.openai],
        ['Gemini', data.byProvider.gemini],
        ['DeepSeek', data.byProvider.deepseek],
      ] as const)
    : [];

  const detailBody = (
    <>
      {error && (
        <p className="text-[11px] text-rose-400/90 leading-snug">{error}</p>
      )}

      {!error && !loading && data && (
        <>
          {/* Amount + plan — desktop only (mobile shows in the collapsed line) */}
          <div className="hidden lg:flex items-baseline justify-between gap-2">
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
            {providerRows.map(([label, bucket]) => (
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
    </>
  );

  return (
    <div
      className={cn(
        'pointer-events-none z-30',
        'absolute inset-x-0 top-0 px-3 pt-2',
        'lg:inset-x-auto lg:left-auto lg:right-4 lg:top-14 lg:w-52 lg:px-0 lg:pt-0',
        className
      )}
    >
      <div
        className={cn(
          'pointer-events-auto rounded-xl border border-white/5 bg-black/40 px-3 py-2.5',
          'lg:bg-black/70 lg:backdrop-blur-sm lg:shadow-lg'
        )}
      >
        {/* Mobile: single collapsed line */}
        <button
          type="button"
          className="lg:hidden w-full flex items-center justify-between gap-2 text-left"
          onClick={() => setMobileOpen((o) => !o)}
          aria-expanded={mobileOpen}
        >
          <span className="text-[12px] font-medium text-[#F5F5F5] tabular-nums truncate">
            Usage {loading ? '…' : error ? '—' : spentLabel}
          </span>
          <span className="flex items-center gap-1.5 flex-shrink-0">
            {loading && <Loader2 size={12} className="animate-spin text-[#6B7280]" />}
            <ChevronDown
              size={14}
              className={cn(
                'text-[#6B7280] transition-transform',
                mobileOpen && 'rotate-180'
              )}
            />
          </span>
        </button>

        {/* Desktop header */}
        <div className="hidden lg:flex items-center justify-between gap-2 mb-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-[#6B7280]">
            Usage
          </p>
          {loading && <Loader2 size={12} className="animate-spin text-[#6B7280]" />}
        </div>

        {/* Details: always on desktop; mobile when expanded */}
        <div className={cn(mobileOpen ? 'mt-2 block' : 'hidden', 'lg:mt-0 lg:block')}>
          {detailBody}
        </div>
      </div>
    </div>
  );
}
