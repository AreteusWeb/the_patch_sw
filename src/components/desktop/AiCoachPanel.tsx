import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Send,
  MessageSquarePlus,
  Loader2,
  Mic,
  Volume2,
} from 'lucide-react';
import useStore from '../../store/useStore';
import { API_BASE } from '../../lib/appConfig';
import { getHrvProxyMs, getRecoveryScore } from '../../utils/fitnessMetrics';
import { cn } from '../../utils/cn';
import { useVoiceInput } from '../../hooks/useVoiceInput';
import { useVoiceOutput } from '../../hooks/useVoiceOutput';
import LiveCoachSessionView from './LiveCoachSessionView';

interface AiCoachPanelProps {
  onClose: () => void;
  /** embedded = desktop resizable column; fullscreen = mobile full-screen sheet */
  presentation?: 'embedded' | 'fullscreen';
}

type CoachInteractionMode = 'text' | 'live';

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
 * AI Coach layout panel — text chat (function calling) or Voice & Video (Live API).
 * Mounted inside a resizable Panel (desktop/mobile); not an overlay drawer.
 */
const AiCoachPanel: React.FC<AiCoachPanelProps> = ({
  onClose,
  presentation = 'embedded',
}) => {
  const isFullscreen = presentation === 'fullscreen';
  const currentUser = useStore(s => s.currentUser);
  const vitals = useStore(s => s.vitals);
  const hasRealData = useStore(s => s.hasRealData);

  const [interactionMode, setInteractionMode] =
    useState<CoachInteractionMode>('text');
  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [startingNew, setStartingNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionLimitReached, setSessionLimitReached] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const voiceModeRef = useRef(false);
  const loadingRef = useRef(false);
  const prevSpeakingRef = useRef(false);
  const sendMessageRef = useRef<(text?: string) => Promise<void>>(async () => {});

  voiceModeRef.current = voiceMode;
  loadingRef.current = loading;

  const { speak, isSpeaking, cancel: cancelSpeech, isSupported: ttsSupported } =
    useVoiceOutput();

  const {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported: sttSupported,
  } = useVoiceInput({
    onFinalTranscript: (text) => {
      stopListening();
      setVoiceDraft(false);
      setInput('');
      void sendMessageRef.current(text);
    },
    onIdleTimeout: () => {
      setVoiceMode(false);
      voiceModeRef.current = false;
      setVoiceDraft(false);
      setInput('');
    },
  });

  const voiceSupported = sttSupported && ttsSupported;

  const resizeComposer = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxPx = 5 * 20; // ~5 lines
    el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
  };

  useEffect(() => {
    if (interactionMode !== 'text') return;
    const t = window.setTimeout(() => {
      inputRef.current?.focus();
      resizeComposer();
    }, 200);
    return () => window.clearTimeout(t);
  }, [interactionMode]);

  useEffect(() => {
    resizeComposer();
  }, [input]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, interactionMode]);

  // Live interim transcript into the composer while listening.
  useEffect(() => {
    if (!voiceMode || !isListening) return;
    setInput(transcript);
    setVoiceDraft(true);
  }, [transcript, isListening, voiceMode]);

  // Tear down STT/TTS when leaving text mode or unmounting.
  useEffect(() => {
    if (interactionMode === 'text') return;
    setVoiceMode(false);
    voiceModeRef.current = false;
    stopListening();
    cancelSpeech();
    setVoiceDraft(false);
  }, [interactionMode, stopListening, cancelSpeech]);

  useEffect(() => {
    return () => {
      stopListening();
      cancelSpeech();
    };
  }, [stopListening, cancelSpeech]);

  const selectInteractionMode = (mode: CoachInteractionMode) => {
    // Switching away from Voice & Video unmounts LiveCoachSessionView →
    // useLiveCoachSession cleanup stops cam/mic/WS.
    setInteractionMode(mode);
  };

  // After coach finishes speaking, resume listening if voice mode is still on.
  useEffect(() => {
    const wasSpeaking = prevSpeakingRef.current;
    prevSpeakingRef.current = isSpeaking;
    if (
      wasSpeaking &&
      !isSpeaking &&
      voiceModeRef.current &&
      !loadingRef.current &&
      !sessionLimitReached
    ) {
      startListening();
    }
  }, [isSpeaking, sessionLimitReached, startListening]);

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

  const resumeVoiceListening = () => {
    if (!voiceModeRef.current || sessionLimitReached) return;
    window.setTimeout(() => startListening(), 80);
  };

  const startNewConversation = async () => {
    if (startingNew || loading) return;

    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      setError('Sign in required to chat with the AI Coach.');
      return;
    }

    setStartingNew(true);
    setError(null);
    stopListening();
    cancelSpeech();

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
      setVoiceDraft(false);
      window.setTimeout(() => resizeComposer(), 0);
      if (typeof data.sessionId === 'string') {
        setSessionId(data.sessionId);
      } else {
        setSessionId(null);
      }
      window.setTimeout(() => inputRef.current?.focus(), 100);
      resumeVoiceListening();
    } catch {
      setError('Network error — could not start a new conversation.');
    } finally {
      setStartingNew(false);
    }
  };

  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading || startingNew || sessionLimitReached) return;

    if (!currentUser || typeof currentUser.getIdToken !== 'function') {
      setError('Sign in required to chat with the AI Coach.');
      return;
    }

    // Never listen while waiting for the coach reply.
    stopListening();
    setVoiceDraft(false);
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
          setVoiceMode(false);
          voiceModeRef.current = false;
          return;
        }

        const msg =
          data?.error === 'unauthorized' ? 'Session expired — sign in again.' :
          data?.error === 'missing_message' ? 'Message was empty.' :
          data?.error === 'coach_failed' ? 'Coach could not reply. Try again.' :
          'Could not reach the AI Coach.';
        setError(msg);
        resumeVoiceListening();
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

      if (voiceModeRef.current) {
        const started = speak(replyText);
        if (!started) resumeVoiceListening();
      }
    } catch {
      setError('Network error — could not reach the coach server.');
      resumeVoiceListening();
    } finally {
      setLoading(false);
    }
  };

  sendMessageRef.current = sendMessage;

  const handleVoiceToggle = () => {
    if (!voiceSupported || sessionLimitReached) return;

    // Interrupt coach speech → listen immediately.
    if (isSpeaking) {
      cancelSpeech();
      setVoiceMode(true);
      voiceModeRef.current = true;
      startListening();
      return;
    }

    // Deactivate voice mode.
    if (voiceMode) {
      setVoiceMode(false);
      voiceModeRef.current = false;
      stopListening();
      cancelSpeech();
      setVoiceDraft(false);
      return;
    }

    // Activate voice mode.
    setVoiceMode(true);
    voiceModeRef.current = true;
    setError(null);
    startListening();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const busy = loading || startingNew;
  const voiceState: 'idle' | 'listening' | 'speaking' | 'waiting' =
    isSpeaking
      ? 'speaking'
      : voiceMode && isListening
        ? 'listening'
        : voiceMode
          ? 'waiting'
          : 'idle';

  return (
    <div
      className={cn(
        'h-full min-h-0 flex flex-col',
        isFullscreen ? 'bg-black pt-[env(safe-area-inset-top)]' : 'bg-slate-950/95'
      )}
    >
      <div className="flex items-center justify-between px-4 sm:px-5 pt-4 sm:pt-5 pb-3 border-b border-slate-800/80 flex-shrink-0 gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-[0.22em]">
            Performance
          </p>
          <p className="text-base font-bold text-[#F5F5F5] mt-0.5 truncate leading-tight">
            AI Coach
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 p-0.5 rounded-xl bg-slate-900/50 border border-slate-800/90">
          {interactionMode === 'text' && (
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
          )}
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

      <div className="px-4 sm:px-5 pt-3 pb-2 flex-shrink-0">
        <div
          className="flex bg-slate-900/60 p-1 rounded-full border border-slate-800/50 gap-1"
          role="group"
          aria-label="Coach interaction mode"
        >
          <button
            type="button"
            onClick={() => selectInteractionMode('text')}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] transition-all',
              interactionMode === 'text'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            )}
          >
            Text
          </button>
          <button
            type="button"
            onClick={() => selectInteractionMode('live')}
            className={cn(
              'flex-1 px-3 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em] transition-all',
              interactionMode === 'live'
                ? 'bg-slate-700 text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-300'
            )}
          >
            Voice & Video
          </button>
        </div>
      </div>

      {interactionMode === 'live' ? (
        <div className="flex-1 min-h-0 px-4 sm:px-5 pb-4 flex flex-col">
          <LiveCoachSessionView embedded />
        </div>
      ) : (
        <>
          <div
            ref={listRef}
            className="relative flex-1 min-h-0 overflow-y-auto scrollbar-hide px-4 sm:px-5 py-4 flex flex-col gap-3.5"
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
                {voiceSupported && (
                  <>
                    {' '}
                    Tap the mic for hands-free voice mode.
                  </>
                )}
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
                  style={{ wordBreak: 'break-word', overflowWrap: 'anywhere' }}
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
                  Coach thinking…
                </div>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-slate-800/80 px-4 sm:px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
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
            {voiceMode && (
              <p className="text-[9px] text-teal-400/80 mb-2 tracking-wide">
                {voiceState === 'listening' && 'Listening…'}
                {voiceState === 'speaking' && 'Coach speaking — tap mic to interrupt'}
                {voiceState === 'waiting' && 'Waiting for coach…'}
              </p>
            )}
            <div className="flex items-end gap-2.5">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => {
                  setVoiceDraft(false);
                  setInput(e.target.value);
                }}
                onKeyDown={onKeyDown}
                disabled={
                  busy ||
                  sessionLimitReached ||
                  (voiceMode && isListening) ||
                  isSpeaking
                }
                placeholder={
                  sessionLimitReached
                    ? 'Start a new conversation to continue…'
                    : voiceState === 'listening'
                      ? 'Listening…'
                      : 'Ask your coach…'
                }
                className={cn(
                  'flex-1 min-w-0 resize-none overflow-y-auto scrollbar-hide bg-slate-900/80 border border-slate-700/80 rounded-2xl px-3.5 py-3 focus:outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/25 shadow-[inset_0_1px_0_rgba(245,245,245,0.04)] placeholder:text-[#6B7280] disabled:opacity-50 leading-[1.45] max-h-[6.25rem] transition-[border-color,box-shadow]',
                  // 16px on fullscreen avoids iOS input zoom
                  isFullscreen ? 'text-base' : 'text-[13px]',
                  voiceDraft
                    ? 'text-[#A0A0A8] italic'
                    : 'text-[#F5F5F5]'
                )}
              />
              <button
                type="button"
                onClick={handleVoiceToggle}
                disabled={!voiceSupported || sessionLimitReached}
                className={cn(
                  'relative w-11 h-11 flex items-center justify-center rounded-2xl shrink-0 transition-all disabled:opacity-35',
                  voiceState === 'listening' &&
                    'bg-teal-500 text-slate-950 shadow-[0_0_0_3px_rgba(45,212,191,0.25)]',
                  voiceState === 'speaking' &&
                    'bg-teal-500 text-slate-950',
                  voiceState === 'waiting' &&
                    'bg-teal-500/80 text-slate-950',
                  voiceState === 'idle' &&
                    'bg-teal-500 text-slate-950 hover:bg-teal-400 active:bg-teal-600 active:scale-[0.97]'
                )}
                title={
                  !voiceSupported
                    ? 'Voice mode not supported in this browser'
                    : voiceState === 'speaking'
                      ? 'Tap to interrupt'
                      : voiceMode
                        ? 'Stop voice mode'
                        : 'Start voice mode'
                }
                aria-label={
                  !voiceSupported
                    ? 'Voice mode not supported'
                    : voiceMode
                      ? 'Stop voice mode'
                      : 'Start voice mode'
                }
              >
                {voiceState === 'speaking' ? (
                  <Volume2 size={16} className="relative z-10" strokeWidth={2.5} />
                ) : (
                  <Mic size={16} className="relative z-10" strokeWidth={2.5} />
                )}
                {voiceState === 'listening' && (
                  <span className="absolute inset-0 rounded-2xl bg-teal-300/40 animate-ping pointer-events-none" />
                )}
              </button>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={busy || sessionLimitReached || !input.trim() || voiceDraft}
                className="w-11 h-11 flex items-center justify-center rounded-2xl bg-teal-500 text-slate-950 hover:bg-teal-400 active:bg-teal-600 active:scale-[0.97] transition-all disabled:opacity-35 disabled:hover:bg-teal-500 disabled:active:scale-100 shrink-0"
                aria-label="Send message"
              >
                <Send size={16} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default AiCoachPanel;
