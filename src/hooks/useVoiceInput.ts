/**
 * useVoiceInput — wraps the browser SpeechRecognition API (Chrome / Edge).
 * - End-of-turn: final result + ~1200ms silence → onFinalTranscript
 * - Idle mic off: ~10s with no speech activity → stop + onIdleTimeout
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const SILENCE_MS = 1200;
const IDLE_MS = 10_000;

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike> & { length: number };
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function detectLang(): string {
  // Default American English for STT — OS locale (e.g. es-MX) confuses English speech.
  return 'en-US';
}

export interface UseVoiceInputOptions {
  onFinalTranscript?: (text: string) => void;
  /** Fired when the mic auto-stops after IDLE_MS with no speech. */
  onIdleTimeout?: () => void;
  lang?: string;
}

export function useVoiceInput(options: UseVoiceInputOptions = {}) {
  const [isSupported] = useState(() => Boolean(getSpeechRecognitionCtor()));
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const finalBufferRef = useRef('');
  const interimRef = useRef('');
  const wantListeningRef = useRef(false);
  const onFinalRef = useRef(options.onFinalTranscript);
  const onIdleRef = useRef(options.onIdleTimeout);
  onFinalRef.current = options.onFinalTranscript;
  onIdleRef.current = options.onIdleTimeout;

  const lang = options.lang ?? detectLang();

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current != null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const stopListening = useCallback(() => {
    wantListeningRef.current = false;
    clearSilenceTimer();
    clearIdleTimer();
    const rec = recognitionRef.current;
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.stop();
      } catch {
        try {
          rec.abort();
        } catch {
          /* ignore */
        }
      }
    }
    recognitionRef.current = null;
    setIsListening(false);
  }, [clearSilenceTimer, clearIdleTimer]);

  const emitFinalIfReady = useCallback(() => {
    const text = finalBufferRef.current.trim();
    finalBufferRef.current = '';
    interimRef.current = '';
    setTranscript('');
    if (text) {
      onFinalRef.current?.(text);
    }
  }, []);

  const scheduleSilenceCommit = useCallback(() => {
    clearSilenceTimer();
    silenceTimerRef.current = window.setTimeout(() => {
      silenceTimerRef.current = null;
      emitFinalIfReady();
    }, SILENCE_MS);
  }, [clearSilenceTimer, emitFinalIfReady]);

  const scheduleIdleTimeout = useCallback(() => {
    clearIdleTimer();
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      if (!wantListeningRef.current) return;
      // No speech for IDLE_MS — turn mic off.
      wantListeningRef.current = false;
      clearSilenceTimer();
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.onresult = null;
          rec.onerror = null;
          rec.onend = null;
          rec.stop();
        } catch {
          try {
            rec.abort();
          } catch {
            /* ignore */
          }
        }
      }
      recognitionRef.current = null;
      finalBufferRef.current = '';
      interimRef.current = '';
      setTranscript('');
      setIsListening(false);
      onIdleRef.current?.();
    }, IDLE_MS);
  }, [clearIdleTimer, clearSilenceTimer]);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    // Restart cleanly if already running.
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }

    wantListeningRef.current = true;
    finalBufferRef.current = '';
    interimRef.current = '';
    setTranscript('');
    scheduleIdleTimeout();

    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      // Any audio activity resets the 10s idle mic-off timer.
      scheduleIdleTimeout();

      let interim = '';
      let gotFinal = false;

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const piece = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalBufferRef.current = `${finalBufferRef.current}${piece} `.replace(
            /\s+/g,
            ' '
          );
          gotFinal = true;
        } else {
          interim += piece;
        }
      }

      interimRef.current = interim;
      const display = `${finalBufferRef.current}${interim}`.trimStart();
      setTranscript(display);

      if (gotFinal) {
        scheduleSilenceCommit();
      } else if (finalBufferRef.current.trim()) {
        // Keep pushing the silence window while interim continues after a final.
        scheduleSilenceCommit();
      }
    };

    rec.onerror = (event) => {
      // 'aborted' / 'no-speech' are expected during stop / silence.
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      console.warn('[useVoiceInput]', event.error);
    };

    rec.onend = () => {
      // Chrome often ends recognition; restart if we still want to listen.
      if (wantListeningRef.current) {
        try {
          rec.start();
          setIsListening(true);
        } catch {
          setIsListening(false);
          wantListeningRef.current = false;
          clearIdleTimer();
        }
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
      setIsListening(true);
    } catch (err) {
      console.warn('[useVoiceInput] start failed:', err);
      setIsListening(false);
      wantListeningRef.current = false;
      clearIdleTimer();
    }
  }, [lang, scheduleSilenceCommit, scheduleIdleTimeout, clearIdleTimer]);

  useEffect(() => {
    return () => {
      wantListeningRef.current = false;
      clearSilenceTimer();
      clearIdleTimer();
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.onend = null;
          rec.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, [clearSilenceTimer, clearIdleTimer]);

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
  };
}
