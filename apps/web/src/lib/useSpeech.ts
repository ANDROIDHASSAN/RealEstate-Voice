import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Map dashboard locales to speech-recognition language tags. */
const SPEECH_LANG: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  ar: 'ar-SA',
  pt: 'pt-BR',
  ht: 'fr-HT',
};

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function getRecognizer(): SpeechRecognitionLike | null {
  const w = window as unknown as Record<string, unknown>;
  const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined;
  return Ctor ? new Ctor() : null;
}

/**
 * Hands-free control: browser speech-to-text (Web Speech API) in the
 * dashboard language. Degrades gracefully — `supported: false` keeps the
 * typed command bar as the only input, never a crash.
 */
export function useSpeech(onFinalTranscript: (text: string) => void): {
  supported: boolean;
  listening: boolean;
  interim: string;
  start: () => void;
  stop: () => void;
} {
  const { i18n } = useTranslation();
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recognizer = useRef<SpeechRecognitionLike | null>(null);
  const callback = useRef(onFinalTranscript);
  callback.current = onFinalTranscript;
  const supported = typeof window !== 'undefined' && Boolean(getRecognizer);
  const [available] = useState(() => getRecognizer() !== null);

  const stop = useCallback(() => {
    recognizer.current?.stop();
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const rec = getRecognizer();
    if (!rec) return;
    recognizer.current?.abort();
    recognizer.current = rec;
    rec.lang = SPEECH_LANG[i18n.language] ?? 'en-US';
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let finalText = '';
      let interimText = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const alt = e.results[i]?.[0];
        if (!alt) continue;
        const isFinal = (e.results[i] as unknown as { isFinal?: boolean }).isFinal;
        if (isFinal) finalText += alt.transcript;
        else interimText += alt.transcript;
      }
      setInterim(interimText);
      if (finalText.trim()) {
        callback.current(finalText.trim());
        setInterim('');
      }
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
    };
    rec.onerror = () => {
      setListening(false);
      setInterim('');
    };
    rec.start();
    setListening(true);
  }, [i18n.language]);

  useEffect(() => () => recognizer.current?.abort(), []);

  return { supported: supported && available, listening, interim, start, stop };
}

/** Speak a reply aloud in the dashboard language (used when voice mode is on). */
export function speak(text: string, locale: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG[locale] ?? 'en-US';
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}
