/**
 * useVoiceOutput — wraps speechSynthesis for coach replies.
 * Strips URLs, markdown links, and Unsplash "Photo by" attribution lines.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

function cleanTextForSpeech(raw: string): string {
  return String(raw || '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split('\n')
    .filter((line) => !/^\s*Photo by\b/i.test(line))
    .join(' ')
    .replace(/\*{1,2}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function useVoiceOutput() {
  const [isSupported] = useState(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const cancel = useCallback(() => {
    if (!isSupported) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    utteranceRef.current = null;
    setIsSpeaking(false);
  }, [isSupported]);

  const speak = useCallback(
    (text: string): boolean => {
      if (!isSupported) return false;
      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) {
        setIsSpeaking(false);
        return false;
      }

      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utteranceRef.current = utterance;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
        }
        setIsSpeaking(false);
      };
      utterance.onerror = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
        }
        setIsSpeaking(false);
      };

      setIsSpeaking(true);
      window.speechSynthesis.speak(utterance);
      return true;
    },
    [isSupported]
  );

  useEffect(() => {
    return () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return {
    speak,
    isSpeaking,
    cancel,
    isSupported,
  };
}
