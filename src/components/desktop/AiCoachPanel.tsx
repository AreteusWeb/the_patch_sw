import React, { useEffect, useRef, useState } from 'react';
import { X, Send, MessageSquarePlus, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import useStore from '../../store/useStore';
import { API_BASE } from '../../lib/appConfig';
import { getHrvProxyMs, getRecoveryScore } from '../../utils/fitnessMetrics';
import { cn } from '../../utils/cn';

interface AiCoachPanelProps {
  open: boolean;
  onClose: () => void;
}

type CoachRole = 'user' | 'model';

interface CoachImageAttachment {
  type: 'image';
  imageUrl: string;
  photographerName: string;
  photographerProfileUrl: string;
}

interface CoachChatMessage {
  id: string;
  role: CoachRole;
  text: string;
  attachments?: CoachImageAttachment[];
}

/** Break "1. … 2. …" into lines when the model dumps a list in one paragraph. */
function normalizeCoachText(text: string): string {
  if (text.includes('\n')) return text;
  return text.replace(/\s+(\d+)\.\s+/g, '\n$1. ');
}

/** Render light markdown: **bold** and line breaks (no HTML injection). */
function CoachMessageBody({ text }: { text: string }) {
  const normalized = normalizeCoachText(text);
  const lines = normalized.split('\n');

  return (
    <span className="whitespace-pre-wrap">
      {lines.map((line, lineIdx) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
          <React.Fragment key={lineIdx}>
            {lineIdx > 0 && '\n'}
            {parts.map((part, partIdx) => {
              const bold = /^\*\*([^*]+)\*\*$/.exec(part);
              if (bold) {
                return (
                  <strong
                    key={partIdx}
                    className="font-semibold text-[#F5F5F5]"
                  >
                    {bold[1]}
                  </strong>
                );
              }
              return <React.Fragment key={partIdx}>{part}</React.Fragment>;
            })}
          </React.Fragment>
        );
      })}
    </span>
  );
}

/** Unsplash attribution (required by Unsplash API guidelines). */
function CoachImageAttachmentView({
  attachment,
}: {
  attachment: CoachImageAttachment;
}) {
  const [broken, setBroken] = useState(false);
  const profileUrl =
    attachment.photographerProfileUrl || 'https://unsplash.com';
  const name = attachment.photographerName || 'Unknown';

  return (
    <div className="mt-3 w-full min-w-0">
      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/80 p-1.5 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.5)]">
        {!broken ? (
          <img
            src={attachment.imageUrl}
            alt=""
            loading="lazy"
            className="block w-full max-w-full h-auto rounded-[12px]"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="w-full h-28 rounded-[12px] bg-slate-900/80 flex items-center justify-center text-[10px] text-[#6B7280]">
            Image unavailable
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[8px] leading-normal text-[#6B7280]">
        Photo by{' '}
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#6B7280]/60 text-[#A0A0A8] hover:text-teal-400"
        >
          {name}
        </a>{' '}
        on{' '}
        <a
          href="https://unsplash.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#6B7280]/60 text-[#A0A0A8] hover:text-teal-400"
        >
          Unsplash
        </a>
      </p>
    </div>
  );
}

/**
 * Fitness AI Coach drawer — chats with POST /api/coach/message.
 * Visual pattern matches AlertsDrawer / ProfileDrawer (right-side panel).
 */
const AiCoachPanel: React.FC<AiCoachPanelProps> = ({ open, onClose }) => {
  const currentUser = useStore(s => s.currentUser);
  const vitals = useStore(s => s.vitals);
  const hasRealData = useStore(s => s.hasRealData);

  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [startingNew, setStartingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionLimitReached, setSessionLimitReached] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const resizeComposer = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxPx = 5 * 20; // ~5 lines
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  };

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      resizeComposer();
    }, 200);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    resizeComposer();
  }, [input]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, open]);

  const buildMetricsSnapshot = () => {
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
  };

  const startNewConversation = async () => {
    if (startingNew || loading) return;

    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      setError('Sign in required to chat with the AI Coach.');
      return;
    }

    setStartingNew(true);
    setError(null);

    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_BASE}/api/coach/new-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ metricsSnapshot: buildMetricsSnapshot() }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(
          data?.error === 'unauthorized'
            ? 'Session expired — sign in again.'
            : 'Could not start a new conversation.'
        );
        return;
      }

      setMessages([]);
      setSessionLimitReached(false);
      setInput('');
      window.setTimeout(() => resizeComposer(), 0);
      if (typeof data.sessionId === 'string') {
        setSessionId(data.sessionId);
      } else {
        setSessionId(null);
      }
      window.setTimeout(() => inputRef.current?.focus(), 100);
    } catch {
      setError('Network error — could not start a new conversation.');
    } finally {
      setStartingNew(false);
    }
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || startingNew || sessionLimitReached) return;

    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      setError('Sign in required to chat with the AI Coach.');
      return;
    }

    setError(null);
    setInput('');
    window.setTimeout(() => resizeComposer(), 0);

    const userMsg: CoachChatMessage = {
      id: `u_${Date.now()}`,
      role: 'user',
      text,
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      const token = await currentUser.getIdToken();
      const res = await fetch(`${API_BASE}/api/coach/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          metricsSnapshot: buildMetricsSnapshot(),
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (data?.error === 'session_limit_reached') {
          setSessionLimitReached(true);
          setError(
            data.message ||
              'This coaching session has reached its message limit. Please start a new conversation.'
          );
          return;
        }

        const msg =
          data?.error === 'unauthorized' ? 'Session expired — sign in again.' :
          data?.error === 'missing_message' ? 'Message was empty.' :
          data?.error === 'coach_failed' ? 'Coach could not reply. Try again.' :
          'Could not reach the AI Coach.';
        setError(msg);
        return;
      }

      setSessionLimitReached(false);

      if (typeof data.sessionId === 'string') {
        setSessionId(data.sessionId);
      }

      const replyText =
        typeof data.reply === 'string' && data.reply.trim()
          ? data.reply.trim()
          : 'No reply from coach.';

      const attachments: CoachImageAttachment[] = Array.isArray(data.attachments)
        ? data.attachments
            .filter(
              (a: unknown): a is CoachImageAttachment =>
                !!a &&
                typeof a === 'object' &&
                (a as CoachImageAttachment).type === 'image' &&
                typeof (a as CoachImageAttachment).imageUrl === 'string' &&
                !!(a as CoachImageAttachment).imageUrl
            )
            .map((a: CoachImageAttachment) => ({
              type: 'image' as const,
              imageUrl: a.imageUrl,
              photographerName:
                typeof a.photographerName === 'string'
                  ? a.photographerName
                  : 'Unknown',
              photographerProfileUrl:
                typeof a.photographerProfileUrl === 'string'
                  ? a.photographerProfileUrl
                  : 'https://unsplash.com',
            }))
        : [];

      setMessages(prev => [
        ...prev,
        {
          id: `m_${Date.now()}`,
          role: 'model',
          text: replyText,
          attachments,
        },
      ]);
    } catch {
      setError('Network error — could not reach the coach server.');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const busy = loading || startingNew;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="coach-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            key="coach-panel"
            initial={{ x: '100%', opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: '100%', opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-[28rem] sm:max-w-[32rem] z-[70] flex flex-col bg-slate-950/95 backdrop-blur-2xl shadow-2xl border-l border-slate-800/80"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-slate-800/80 flex-shrink-0 gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.22em]">
                  Performance
                </p>
                <p className="text-base font-bold text-[#F5F5F5] mt-0.5 truncate leading-tight">
                  AI Coach
                </p>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 p-0.5 rounded-xl bg-slate-900/50 border border-slate-800/90">
                <button
                  type="button"
                  onClick={() => void startNewConversation()}
                  disabled={busy}
                  className="flex items-center justify-center gap-1.5 h-9 min-w-9 px-2.5 rounded-lg text-[10px] font-bold uppercase tracking-wider text-[#A0A0A8] hover:bg-teal-500/15 hover:text-teal-400 transition-colors disabled:opacity-40"
                  title="Start a new conversation"
                >
                  {startingNew ? (
                    <Loader2 size={14} className="animate-spin text-teal-400" />
                  ) : (
                    <MessageSquarePlus size={14} />
                  )}
                  {startingNew ? 'Starting' : 'New'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-9 h-9 flex items-center justify-center rounded-lg text-[#A0A0A8] hover:text-[#F5F5F5] hover:bg-slate-800/80 transition-colors"
                  aria-label="Close AI Coach"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={listRef}
              className="relative flex-1 min-h-0 overflow-y-auto scrollbar-hide px-5 py-5 flex flex-col gap-3.5"
            >
              {startingNew && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/70 backdrop-blur-[2px]">
                  <Loader2 size={28} className="animate-spin text-[#A0A0A8]" />
                  <p className="text-[11px] text-[#A0A0A8] font-medium">
                    Starting new conversation…
                  </p>
                </div>
              )}

              {messages.length === 0 && !loading && !startingNew && (
                <p className="text-[12px] text-[#6B7280] leading-[1.5] px-0.5">
                  Ask about training, recovery, hydration, or effort. This is
                  performance coaching — not medical advice.
                </p>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex min-w-0 w-full',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] min-w-0 px-3.5 py-3 text-[13px] leading-[1.45] break-words [overflow-wrap:anywhere] text-[#F5F5F5]',
                      msg.role === 'user'
                        ? 'bg-slate-700/90 border border-slate-600/50 font-medium rounded-[16px] rounded-br-[4px]'
                        : 'bg-slate-800/70 border border-slate-700/60 rounded-[16px] rounded-bl-[4px]'
                    )}
                    style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}
                  >
                    {msg.role === 'model' ? (
                      <CoachMessageBody text={msg.text} />
                    ) : (
                      msg.text
                    )}
                    {msg.role === 'model' &&
                      Array.isArray(msg.attachments) &&
                      msg.attachments.map((att, idx) => (
                        <CoachImageAttachmentView
                          key={`${msg.id}_img_${idx}`}
                          attachment={att}
                        />
                      ))}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-800/70 border border-slate-700/60 text-[#A0A0A8] text-[12px] px-3.5 py-3 rounded-[16px] rounded-bl-[4px] italic flex items-center gap-2 leading-[1.45]">
                    <Loader2 size={13} className="animate-spin text-[#A0A0A8]" />
                    Coach is typing…
                  </div>
                </div>
              )}
            </div>

            {/* Error + composer */}
            <div className="flex-shrink-0 border-t border-slate-800/80 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {error && (
                <div className="mb-3 space-y-2">
                  <p className="text-[11px] text-rose-400 leading-[1.45]">{error}</p>
                  {sessionLimitReached && (
                    <button
                      type="button"
                      onClick={() => void startNewConversation()}
                      disabled={busy}
                      className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-teal-500/40 bg-transparent text-[10px] font-bold uppercase tracking-wider text-teal-400 hover:bg-teal-500/10 transition-colors disabled:opacity-40"
                    >
                      {startingNew ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <MessageSquarePlus size={13} />
                      )}
                      {startingNew ? 'Starting…' : 'Start new conversation'}
                    </button>
                  )}
                </div>
              )}
              {sessionId && (
                <p className="text-[8px] text-[#6B7280] uppercase tracking-wider mb-2 truncate">
                  Session {sessionId}
                </p>
              )}
              <div className="flex items-end gap-2.5">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={busy || sessionLimitReached}
                  placeholder={
                    sessionLimitReached
                      ? 'Start a new conversation to continue…'
                      : 'Ask your coach…'
                  }
                  className="flex-1 min-w-0 resize-none overflow-y-auto scrollbar-hide bg-slate-900/80 border border-slate-700/80 text-[#F5F5F5] text-[13px] rounded-2xl px-3.5 py-3 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 shadow-[inset_0_1px_0_rgba(245,245,245,0.04)] placeholder:text-[#6B7280] disabled:opacity-50 leading-[1.45] max-h-[6.25rem] transition-[border-color,box-shadow]"
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={busy || sessionLimitReached || !input.trim()}
                  className="w-11 h-11 flex items-center justify-center rounded-2xl bg-teal-500 text-slate-950 hover:bg-teal-400 active:bg-teal-600 active:scale-[0.97] transition-all disabled:opacity-35 disabled:hover:bg-teal-500 disabled:active:scale-100 shrink-0"
                  aria-label="Send message"
                >
                  <Send size={16} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default AiCoachPanel;
