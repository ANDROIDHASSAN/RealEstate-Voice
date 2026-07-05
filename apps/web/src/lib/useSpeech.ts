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
export function useSpeech(
  onFinalTranscript: (text: string) => void,
  opts?: {
    /**
     * Fires when recognition ends ON ITS OWN with no final result — a silence
     * timeout or a transient hiccup (no-speech / network / aborted). Lets a
     * continuous surface (Voice Mode, the live demo call) re-open the mic so the
     * ear never dies after one command. NOT fired on an explicit stop() or a
     * permission denial.
     */
    onIdleEnd?: () => void;
  },
): {
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
  const idleEnd = useRef(opts?.onIdleEnd);
  idleEnd.current = opts?.onIdleEnd;
  const manualStop = useRef(false); // did WE stop it (vs. it ending on its own)?
  const gotFinal = useRef(false); // did this session produce a final transcript?
  const supported = typeof window !== 'undefined' && Boolean(getRecognizer);
  const [available] = useState(() => getRecognizer() !== null);

  const stop = useCallback(() => {
    manualStop.current = true;
    try {
      recognizer.current?.stop();
    } catch {
      /* already stopped */
    }
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    const rec = getRecognizer();
    if (!rec) return;
    // Tear down any previous recognizer FIRST — and detach its handlers before
    // aborting. abort() fires onend asynchronously, a tick after we reset the
    // shared flags below; if that stale onend still ran it would (falsely) think
    // it ended on its own and trigger onIdleEnd → an endless ~300ms
    // abort/restart churn that stops the 2nd command from ever being heard.
    const prev = recognizer.current;
    if (prev) {
      prev.onend = null;
      prev.onerror = null;
      prev.onresult = null;
      try {
        prev.abort();
      } catch {
        /* ignore */
      }
    }
    recognizer.current = rec;
    manualStop.current = false;
    gotFinal.current = false;
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
        gotFinal.current = true;
        callback.current(finalText.trim());
        setInterim('');
      }
    };
    rec.onend = () => {
      setListening(false);
      setInterim('');
      // Ended on its own with nothing heard → let the caller keep the ear open.
      if (!manualStop.current && !gotFinal.current) idleEnd.current?.();
    };
    rec.onerror = (ev) => {
      setListening(false);
      setInterim('');
      // A denied mic is terminal; everything else (no-speech, network, aborted)
      // is transient — keep the continuous loop alive.
      const fatal = ev.error === 'not-allowed' || ev.error === 'service-not-allowed';
      if (!manualStop.current && !fatal) idleEnd.current?.();
    };
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if a previous instance is still closing — onend/onerror
      // from that instance will trigger a re-open, so just swallow it.
    }
  }, [i18n.language]);

  useEffect(() => () => {
    try {
      recognizer.current?.abort();
    } catch {
      /* ignore */
    }
  }, []);

  return { supported: supported && available, listening, interim, start, stop };
}

/**
 * Speak a reply aloud in the dashboard language. `onEnd` fires when speech
 * finishes (or immediately if TTS is unavailable / muted) — used to drive the
 * hands-free call loop (agent speaks → then we listen).
 */
export function speak(text: string, locale: string, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !text.trim()) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG[locale] ?? 'en-US';
  utterance.rate = 1.02;
  let done = false;
  const finish = () => { if (!done) { done = true; onEnd?.(); } };
  utterance.onend = finish;
  utterance.onerror = finish;
  window.speechSynthesis.speak(utterance);
  // Safety net: some browsers drop onend — estimate by length (~14 chars/sec).
  window.setTimeout(finish, Math.min(30_000, 1200 + text.length * 75));
}

/** Stop any in-progress speech immediately. */
export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

/**
 * Microphone level meter + voice-activity detection, used for barge-in (letting
 * the caller talk over the agent) and to animate the call orb. Uses getUserMedia
 * with echo cancellation so the agent's own TTS (played through the speakers)
 * is suppressed from the mic and doesn't trip the detector. Best-effort: if the
 * mic is denied/unavailable, everything degrades to tap-to-interrupt.
 */
export function useMicLevel(): {
  level: number;
  ready: boolean;
  ensure: () => Promise<boolean>;
  arm: () => void;
  disarm: () => void;
  onSpeech: (cb: (() => void) | null) => void;
  stopAll: () => void;
} {
  const [level, setLevel] = useState(0);
  const [ready, setReady] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>();
  const armedRef = useRef(false);
  const loudRef = useRef(0);
  const cbRef = useRef<(() => void) | null>(null);

  const loop = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const v = (buf[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    setLevel((l) => l * 0.75 + rms * 0.25);
    // Barge-in: sustained energy above threshold while armed → fire once.
    if (armedRef.current && rms > 0.055) {
      loudRef.current += 1;
      if (loudRef.current >= 4) {
        armedRef.current = false;
        loudRef.current = 0;
        cbRef.current?.();
      }
    } else if (loudRef.current > 0) {
      loudRef.current -= 1;
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const ensure = useCallback(async () => {
    if (ready) return true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) return false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      const ctx = new Ctx();
      if (ctx.state === 'suspended') await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      setReady(true);
      rafRef.current = requestAnimationFrame(loop);
      return true;
    } catch {
      return false;
    }
  }, [ready, loop]);

  const arm = useCallback(() => { loudRef.current = 0; armedRef.current = true; }, []);
  const disarm = useCallback(() => { armedRef.current = false; loudRef.current = 0; }, []);
  const onSpeech = useCallback((cb: (() => void) | null) => { cbRef.current = cb; }, []);
  const stopAll = useCallback(() => {
    armedRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    analyserRef.current = null;
    streamRef.current = null;
    setReady(false);
  }, []);

  useEffect(() => () => stopAll(), [stopAll]);
  return { level, ready, ensure, arm, disarm, onSpeech, stopAll };
}
