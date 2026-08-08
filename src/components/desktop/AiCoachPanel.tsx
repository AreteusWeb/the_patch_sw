import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Sparkles, MessageSquarePlus, Loader2 } from 'lucide-react';
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

interface CoachChatMessage {
  id: string;
  role: CoachRole;
  text: string;
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 200);
    return () => window.clearTimeout(t);
  }, [open]);

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

      setMessages(prev => [
        ...prev,
        { id: `m_${Date.now()}`, role: 'model', text: replyText },
      ]);
    } catch {
      setError('Network error — could not reach the coach server.');
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
            className="fixed right-0 top-0 h-full w-[22rem] z-[70] flex flex-col bg-slate-950/95 backdrop-blur-2xl shadow-2xl border-l border-slate-800/80"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-6 pb-4 border-b border-slate-800/80 flex-shrink-0 gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-teal-500/10 border border-teal-500/20 text-teal-400 flex items-center justify-center shrink-0">
                  <Sparkles size={15} />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-slate-500 uppercase tracking-[0.25em]">
                    Performance
                  </p>
                  <p className="text-sm font-semibold text-white mt-0.5 truncate">
                    AI Coach
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void startNewConversation()}
                  disabled={busy}
                  className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-slate-800 bg-slate-900/60 text-[9px] font-bold uppercase tracking-wider text-slate-300 hover:text-white hover:border-teal-500/40 hover:bg-teal-500/10 transition-all disabled:opacity-40"
                  title="Start a new conversation"
                >
                  {startingNew ? (
                    <Loader2 size={13} className="animate-spin text-teal-400" />
                  ) : (
                    <MessageSquarePlus size={13} />
                  )}
                  {startingNew ? 'Starting' : 'New'}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-700 transition-all"
                  aria-label="Close AI Coach"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              ref={listRef}
              className="relative flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 py-4 flex flex-col gap-3"
            >
              {startingNew && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-slate-950/70 backdrop-blur-[2px]">
                  <Loader2 size={28} className="animate-spin text-teal-400" />
                  <p className="text-[11px] text-slate-400 font-medium">
                    Starting new conversation…
                  </p>
                </div>
              )}

              {messages.length === 0 && !loading && !startingNew && (
                <p className="text-[11px] text-slate-500 leading-relaxed px-1">
                  Ask about training, recovery, hydration, or effort. This is
                  performance coaching — not medical advice.
                </p>
              )}

              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'flex',
                    msg.role === 'user' ? 'justify-end' : 'justify-start'
                  )}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-2xl px-3 py-2 text-[12px] leading-snug',
                      msg.role === 'user'
                        ? 'bg-teal-500/20 border border-teal-500/30 text-teal-50 rounded-br-md'
                        : 'bg-slate-900/80 border border-slate-800 text-slate-200 rounded-bl-md'
                    )}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-slate-900/80 border border-slate-800 text-slate-400 text-[11px] px-3 py-2 rounded-2xl rounded-bl-md italic flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin text-teal-400" />
                    Coach is typing…
                  </div>
                </div>
              )}
            </div>

            {/* Error + composer */}
            <div className="flex-shrink-0 border-t border-slate-800/80 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {error && (
                <div className="mb-2 space-y-2">
                  <p className="text-[10px] text-rose-400 leading-snug">{error}</p>
                  {sessionLimitReached && (
                    <button
                      type="button"
                      onClick={() => void startNewConversation()}
                      disabled={busy}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-teal-500/30 bg-teal-500/10 text-[10px] font-bold uppercase tracking-wider text-teal-300 hover:bg-teal-500/20 hover:text-teal-200 transition-colors disabled:opacity-40"
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
                <p className="text-[8px] text-slate-600 uppercase tracking-wider mb-1.5 truncate">
                  Session {sessionId}
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  disabled={busy || sessionLimitReached}
                  placeholder={
                    sessionLimitReached
                      ? 'Start a new conversation to continue…'
                      : 'Ask your coach…'
                  }
                  className="flex-1 min-w-0 bg-slate-900/60 border border-slate-800 text-slate-200 text-xs rounded-xl px-3 py-2.5 focus:outline-none focus:border-teal-500/40 focus:ring-1 focus:ring-teal-500/20 placeholder:text-slate-600 disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={busy || sessionLimitReached || !input.trim()}
                  className="w-10 h-10 flex items-center justify-center rounded-xl bg-teal-500 text-slate-950 hover:bg-teal-400 transition-colors disabled:opacity-40 disabled:hover:bg-teal-500 shrink-0"
                  aria-label="Send message"
                >
                  <Send size={15} strokeWidth={2.5} />
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
