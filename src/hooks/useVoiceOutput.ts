/**
 * useVoiceOutput — wraps speechSynthesis for coach replies.
 * Strips URLs, markdown links, and Unsplash "Photo by" attribution lines.
 * Picks an American English voice for English text (avoids Spanish-accent TTS).
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

/** Lightweight Spanish vs English guess for voice selection. */
function detectSpeechLang(text: string): 'en-US' | 'es-MX' {
  const sample = text.slice(0, 400).toLowerCase();
  const spanishHits =
    (sample.match(
      /\b(el|la|los|las|de|que|y|en|un|una|es|por|para|con|como|más|pero|tu|tus|hola|gracias|entrenamiento|recuperación|hidratación)\b/gi
    )?.length ?? 0) +
    (sample.match(/[áéíóúñ¿¡]/g)?.length ?? 0);
  const englishHits =
    sample.match(
      /\b(the|and|you|your|to|for|with|this|that|have|from|recovery|training|hydrate|here's|ready|coach)\b/gi
    )?.length ?? 0;

  return spanishHits > englishHits ? 'es-MX' : 'en-US';
}

function scoreVoice(voice: SpeechSynthesisVoice, lang: 'en-US' | 'es-MX'): number {
  const vLang = (voice.lang || '').toLowerCase();
  const name = (voice.name || '').toLowerCase();
  let score = 0;

  if (lang === 'en-US') {
    if (vLang === 'en-us') score += 100;
    else if (vLang.startsWith('en-us')) score += 90;
    else if (vLang === 'en-gb') score += 40;
    else if (vLang.startsWith('en')) score += 30;
    else return -1;

    // Prefer clearly American / Google US voices when available.
    if (/us english|en-us|american/i.test(name)) score += 25;
    if (/google us english/i.test(name)) score += 40;
    if (/microsoft (aria|guy|jenny|david|zira)/i.test(name)) score += 20;
    // Deprioritize Spanish-named or MX voices accidentally tagged en.
    if (/mexican|español|spanish|mexico/i.test(name)) score -= 80;
  } else {
    if (vLang === 'es-mx') score += 100;
    else if (vLang.startsWith('es-mx')) score += 90;
    else if (vLang === 'es-us') score += 70;
    else if (vLang.startsWith('es')) score += 50;
    else return -1;

    if (/mexican|mexico|es-mx/i.test(name)) score += 25;
    if (/google español/i.test(name)) score += 20;
  }

  if (voice.localService) score += 5;
  if (voice.default) score += 2;
  return score;
}

function pickVoice(
  voices: SpeechSynthesisVoice[],
  lang: 'en-US' | 'es-MX'
): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const score = scoreVoice(voice, lang);
    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }
  return bestScore >= 0 ? best : null;
}

export function useVoiceOutput() {
  const [isSupported] = useState(
    () => typeof window !== 'undefined' && 'speechSynthesis' in window
  );
  const [isSpeaking, setIsSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef = useRef<SpeechSynthesisVoice[]>([]);

  const refreshVoices = useCallback(() => {
    if (!isSupported) return;
    voicesRef.current = window.speechSynthesis.getVoices();
  }, [isSupported]);

  useEffect(() => {
    if (!isSupported) return;
    refreshVoices();
    const onVoices = () => refreshVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', onVoices);
    // Chrome fires voiceschanged; also poll once shortly after mount.
    const t = window.setTimeout(refreshVoices, 250);
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', onVoices);
      window.clearTimeout(t);
    };
  }, [isSupported, refreshVoices]);

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

      // Voices may load late — refresh right before speaking.
      refreshVoices();

      const lang = detectSpeechLang(cleaned);
      const voice = pickVoice(voicesRef.current, lang);

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.lang = lang;
      if (voice) {
        utterance.voice = voice;
        // Keep lang aligned with the chosen voice when possible.
        if (voice.lang) utterance.lang = voice.lang;
      }
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
    [isSupported, refreshVoices]
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
