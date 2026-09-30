import React from 'react';
import { Loader2, MessageSquare, MessageSquarePlus, X } from 'lucide-react';
import { cn } from '../../utils/cn';

export interface CoachSessionListItem {
  sessionId: string;
  startedAt: number | null;
  lastMessageAt: number | null;
  closedAt: number | null;
  summary: string | null;
  messageCount: number;
}

interface CoachHistorySidebarProps {
  sessions: CoachSessionListItem[];
  activeSessionId: string | null;
  listLoading: boolean;
  loadingMore: boolean;
  openingSessionId: string | null;
  deletingSessionId: string | null;
  hasMore: boolean;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onLoadMore: () => void;
  onNewConversation: () => void;
  newDisabled?: boolean;
  newLoading?: boolean;
  /** Block deletes while a coach reply is in flight (it could re-create the doc). */
  deleteDisabled?: boolean;
  className?: string;
}

function formatSessionWhen(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function previewText(summary: string | null, closedAt: number | null): string {
  if (summary && summary.trim()) {
    const t = summary.trim().replace(/\s+/g, ' ');
    return t.length > 72 ? `${t.slice(0, 72)}…` : t;
  }
  return closedAt == null ? 'Active conversation' : 'Conversation';
}

/**
 * Conversation list for the AI Coach panel (ChatGPT-style thread picker).
 */
const CoachHistorySidebar: React.FC<CoachHistorySidebarProps> = ({
  sessions,
  activeSessionId,
  listLoading,
  loadingMore,
  openingSessionId,
  deletingSessionId,
  hasMore,
  onSelect,
  onDelete,
  onLoadMore,
  onNewConversation,
  newDisabled,
  newLoading,
  deleteDisabled,
  className,
}) => {
  return (
    <aside
      className={cn(
        'flex flex-col min-h-0 border-r border-slate-800/80 bg-slate-950/80',
        className
      )}
    >
      <div className="flex-shrink-0 px-3 pt-3 pb-2 border-b border-slate-800/60">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B7280] mb-2">
          Conversations
        </p>
        <button
          type="button"
          onClick={onNewConversation}
          disabled={newDisabled}
          className="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-teal-500/15 text-teal-300 border border-teal-500/30 hover:bg-teal-500/25 transition-colors disabled:opacity-40"
        >
          {newLoading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <MessageSquarePlus size={13} />
          )}
          {newLoading ? 'Starting…' : 'New conversation'}
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-1.5 py-2 flex flex-col gap-0.5">
        {listLoading && sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-[#A0A0A8]">
            <Loader2 size={18} className="animate-spin" />
            <span className="text-[10px]">Loading…</span>
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-[11px] text-[#6B7280] px-2 py-6 leading-relaxed">
            No past conversations yet. Start chatting and they will show up here.
          </p>
        ) : (
          sessions.map((s) => {
            const selected = s.sessionId === activeSessionId;
            const opening = openingSessionId === s.sessionId;
            const deleting = deletingSessionId === s.sessionId;
            return (
              <div
                key={s.sessionId}
                className={cn(
                  'group relative flex items-stretch rounded-lg border transition-colors',
                  selected
                    ? 'bg-teal-500/10 border-teal-500/35'
                    : 'bg-transparent border-transparent hover:bg-slate-900/80 hover:border-slate-800/80',
                  deleting && 'opacity-50'
                )}
              >
              <button
                type="button"
                onClick={() => onSelect(s.sessionId)}
                disabled={opening || deleting}
                className="flex-1 min-w-0 text-left pl-2.5 pr-1 py-2"
              >
                <div className="flex items-start gap-2">
                  <MessageSquare
                    size={12}
                    className={cn(
                      'mt-0.5 shrink-0',
                      selected ? 'text-teal-400' : 'text-[#6B7280]'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span
                        className={cn(
                          'text-[10px] tabular-nums',
                          selected ? 'text-teal-300/90' : 'text-[#6B7280]'
                        )}
                      >
                        {formatSessionWhen(s.lastMessageAt ?? s.startedAt)}
                      </span>
                      {opening ? (
                        <Loader2 size={11} className="animate-spin text-[#A0A0A8]" />
                      ) : (
                        <span className="text-[9px] text-[#6B7280] tabular-nums">
                          {s.messageCount}
                        </span>
                      )}
                    </div>
                    <p
                      className={cn(
                        'text-[11px] leading-snug line-clamp-2',
                        selected ? 'text-[#F5F5F5]' : 'text-[#A0A0A8]'
                      )}
                    >
                      {previewText(s.summary, s.closedAt)}
                    </p>
                  </div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.sessionId)}
                disabled={deleting || opening || deleteDisabled}
                className={cn(
                  'shrink-0 w-7 flex items-start justify-center pt-2 rounded-r-lg text-[#6B7280] hover:text-rose-400 transition-opacity disabled:opacity-30',
                  // Always visible on touch; reveal on hover/focus with a mouse.
                  'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100',
                  (selected || deleting) && 'sm:opacity-100'
                )}
                title="Delete conversation"
                aria-label="Delete conversation"
              >
                {deleting ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <X size={13} />
                )}
              </button>
              </div>
            );
          })
        )}

        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore || listLoading}
            className="mt-1 mx-1 h-8 rounded-lg text-[10px] font-semibold uppercase tracking-wider text-[#A0A0A8] hover:text-teal-300 hover:bg-slate-900/60 disabled:opacity-40"
          >
            {loadingMore ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" />
                Loading…
              </span>
            ) : (
              'Load more'
            )}
          </button>
        )}
      </div>
    </aside>
  );
};

export default CoachHistorySidebar;
