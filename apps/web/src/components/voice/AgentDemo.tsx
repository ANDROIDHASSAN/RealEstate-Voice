import { useMutation } from '@tanstack/react-query';
import { Bot, Keyboard, Mic, PhoneOff, Send, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { speak, stopSpeaking, useMicLevel, useSpeech } from '../../lib/useSpeech';
import { cn } from '../../lib/utils';

interface Turn { role: 'user' | 'agent'; text: string }
type CallState = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * Live browser call — talk to a voice agent with no phone / Vapi.
 *
 * HANDS-FREE by default (like a real call): the agent speaks, then the mic opens
 * automatically for your reply — no tapping between turns, unlimited turns. The
 * self-talk / echo loop is avoided the same proven way Voice Mode does it: the
 * mic uses hardware echo cancellation (getUserMedia) and is only opened AFTER the
 * agent's TTS finishes, while barge-in (talk over the agent to interrupt) is
 * armed during speech. Tap the orb to interrupt; degrades to tap-to-talk if the
 * mic is denied, and to typing where speech recognition is unavailable (iOS
 * Safari / Firefox).
 */
export function AgentDemo({ agentKey, agentName, onClose }: { agentKey: string; agentName: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [state, setState] = useState<CallState>('connecting');
  const [voiceOn, setVoiceOn] = useState(true);
  const [showType, setShowType] = useState(false);
  const [input, setInput] = useState('');
  const [seconds, setSeconds] = useState(0);
  const started = useRef(false);
  const voiceOnRef = useRef(true);
  const stateRef = useRef<CallState>('connecting');
  const liveRef = useRef(true); // call still open (guards async callbacks after hang-up)
  voiceOnRef.current = voiceOn;
  stateRef.current = state;

  const secure = typeof window === 'undefined' || window.isSecureContext;
  const submitRef = useRef<(text: string) => void>(() => {});
  const openMicRef = useRef<() => void>(() => {});

  // Echo-cancelled mic for barge-in (and so auto-listen can't hear the agent).
  const mic = useMicLevel();
  const micRef = useRef(mic);
  micRef.current = mic;

  const { supported: sttSupported, listening, interim, start, stop } = useSpeech(
    (final) => submitRef.current(final),
    {
      // Silence/hiccup while listening → re-open the ear so the line stays open,
      // just like a real phone call. Never strands mid-call.
      onIdleEnd: () => {
        if (liveRef.current && stateRef.current === 'listening') {
          window.setTimeout(() => {
            if (liveRef.current && stateRef.current === 'listening') openMicRef.current();
          }, 250);
        }
      },
    },
  );

  const setCall = (s: CallState) => { stateRef.current = s; setState(s); };

  // Open the mic for the user's turn (auto — no tap). Falls back to a manual
  // "your turn" prompt if speech recognition or the mic is unavailable.
  const openMic = useCallback(() => {
    if (!liveRef.current) return;
    if (!sttSupported) { setCall('idle'); return; }
    stopSpeaking();
    micRef.current.disarm();
    setCall('listening');
    start();
  }, [sttSupported, start]);
  openMicRef.current = openMic;

  // The agent takes a turn: speak it, arm barge-in, then AUTO-open the mic when
  // the speech ends. If muted, skip straight to listening.
  const agentSpeaks = useCallback((text: string) => {
    setCall('speaking');
    if (!voiceOnRef.current) { openMic(); return; }
    // Barge-in: sustained speech energy while the agent talks cancels its TTS
    // and hands the turn to the caller. Arm only after a 600ms grace so the
    // agent's own opening words (even leaking past echo cancellation) can't
    // self-trigger an interrupt.
    micRef.current.onSpeech(() => { stopSpeaking(); openMic(); });
    const graceId = window.setTimeout(() => {
      if (liveRef.current && stateRef.current === 'speaking') micRef.current.arm();
    }, 600);
    speak(text, i18n.language, () => {
      window.clearTimeout(graceId);
      micRef.current.disarm();
      if (liveRef.current && stateRef.current === 'speaking') openMic();
    });
  }, [i18n.language, openMic]);

  const send = useMutation({
    mutationFn: (messages: Turn[]) => api<{ reply: string }>(`/voice-agents/${agentKey}/demo`, { method: 'POST', body: { messages } }),
    onSuccess: (d) => { setTurns((prev) => [...prev, { role: 'agent', text: d.reply }]); agentSpeaks(d.reply); },
    onError: () => agentSpeaks(t('demo.trouble')),
  });

  const submit = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean || send.isPending) return;
    stop();
    setInput('');
    setCall('thinking');
    setTurns((prev) => {
      const next: Turn[] = [...prev, { role: 'user', text: clean }];
      send.mutate(next);
      return next;
    });
  }, [send, stop]);
  submitRef.current = submit;

  const stopListening = useCallback(() => {
    stop();
    if (stateRef.current === 'listening') setCall('idle');
  }, [stop]);

  // Connect: warm up the echo-cancelled mic, then the agent greets and the loop
  // begins — mic auto-opens when the greeting finishes.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    liveRef.current = true;
    void micRef.current.ensure();
    api<{ reply: string }>(`/voice-agents/${agentKey}/demo`, { method: 'POST', body: { messages: [] } })
      .then((d) => { setTurns([{ role: 'agent', text: d.reply }]); agentSpeaks(d.reply); })
      .catch(() => { const g = t('demo.fallbackGreeting'); setTurns([{ role: 'agent', text: g }]); agentSpeaks(g); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hangUp = useCallback(() => {
    liveRef.current = false;
    stopSpeaking();
    stop();
    micRef.current.disarm();
    micRef.current.stopAll();
    onClose();
  }, [onClose, stop]);
  useEffect(() => () => { liveRef.current = false; stopSpeaking(); micRef.current.stopAll(); }, []);

  // Primary control (orb + mic button): interrupt while speaking (take the turn
  // now), pause the mic while listening, else (re)open it.
  const onMicControl = () => {
    if (state === 'speaking') { stopSpeaking(); openMic(); return; }
    if (state === 'listening') stopListening();
    else openMic();
  };

  const lastAgent = [...turns].reverse().find((x) => x.role === 'agent')?.text ?? '';
  const caption = state === 'listening' ? (interim || t('demo.listening')) : lastAgent;
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const statusLabel = { connecting: t('demo.connecting'), idle: t('demo.yourTurn'), listening: t('demo.listening'), thinking: t('demo.thinking'), speaking: t('demo.speaking') }[state];
  const orbClass = state === 'speaking' ? 'bg-card-purple ring-card-purple' : state === 'listening' ? 'bg-card-pink ring-card-pink cf-mic-live' : state === 'thinking' ? 'bg-card-yellow ring-card-yellow' : 'bg-surface-2 ring-black/5';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm sm:p-4" onClick={hangUp}>
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-soft sm:h-[85vh] sm:max-h-[680px] sm:max-w-md sm:rounded-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-black/5 px-5 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-card-purple"><Bot className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{agentName}</p>
            <p className="flex items-center gap-1.5 text-xs text-ink-soft">
              <span className="h-2 w-2 rounded-full bg-green-500 cf-live-dot" /> {t('demo.onCall')} · {mmss}
            </p>
          </div>
          <button onClick={() => setVoiceOn((v) => !v)} title={t('demo.speaker')} className="rounded-full p-2 text-ink-soft hover:bg-black/5">
            {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>

        {/* Live call stage */}
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6 py-4">
          <button
            onClick={onMicControl}
            disabled={state === 'thinking' || state === 'connecting' || !sttSupported}
            title={state === 'speaking' ? t('demo.tapInterrupt') : state === 'listening' ? t('demo.tapStop') : t('demo.tapToSpeak')}
            className={cn('flex h-36 w-36 items-center justify-center rounded-full ring-8 transition-[background-color,box-shadow] duration-300 disabled:opacity-70', orbClass)}
          >
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-surface/70">
              {state === 'listening' ? <Mic className="h-9 w-9" /> : state === 'thinking' ? (
                <span className="flex gap-1"><span className="cf-typing-dot" /><span className="cf-typing-dot" style={{ animationDelay: '150ms' }} /><span className="cf-typing-dot" style={{ animationDelay: '300ms' }} /></span>
              ) : state === 'idle' ? <Mic className="h-9 w-9 text-ink-soft" /> : <Bot className="h-9 w-9" />}
            </div>
          </button>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{statusLabel}</p>
          {sttSupported && state === 'idle' && <p className="-mt-3 text-[11px] text-ink-soft">👆 {t('demo.tapToSpeak')}</p>}
          {sttSupported && state === 'speaking' && <p className="-mt-3 text-[11px] text-ink-soft">{t('demo.tapInterrupt')}</p>}
          <p className="min-h-[3.5rem] max-w-sm text-center text-lg leading-snug" dir="auto">{caption}</p>
        </div>

        {/* Transcript (compact) */}
        {turns.length > 1 && (
          <div className="max-h-24 shrink-0 space-y-1.5 overflow-y-auto border-t border-black/5 px-5 py-2 text-xs">
            {turns.slice(-6).map((turn, i) => (
              <p key={i} className={cn(turn.role === 'user' ? 'text-ink' : 'text-ink-soft')} dir="auto">
                <span className="font-semibold">{turn.role === 'user' ? t('demo.you') : agentName.split(' ')[0]}:</span> {turn.text}
              </p>
            ))}
          </div>
        )}

        {/* Type fallback */}
        {(showType || !sttSupported) && (
          <form className="flex shrink-0 items-center gap-2 border-t border-black/5 px-3 py-2" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('demo.say')} className="h-10 min-w-0 flex-1 rounded-2xl border border-black/5 bg-surface px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ink/15" />
            <button type="submit" disabled={send.isPending || !input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-on disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
        )}

        {/* Call controls — always visible */}
        <div className="flex shrink-0 items-center justify-center gap-4 border-t border-black/5 px-5 py-4">
          {sttSupported && (
            <button onClick={onMicControl} disabled={state === 'thinking' || state === 'connecting'}
              title={state === 'listening' ? t('demo.tapStop') : t('demo.tapToSpeak')}
              className={cn('flex h-14 w-14 items-center justify-center rounded-full transition-colors disabled:opacity-50', state === 'listening' ? 'cf-mic-live bg-card-pink text-ink' : 'bg-card-blue text-ink')}>
              <Mic className="h-6 w-6" />
            </button>
          )}
          <button onClick={hangUp} title={t('demo.hangUp')} className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-soft transition-transform hover:scale-105">
            <PhoneOff className="h-6 w-6" />
          </button>
          {sttSupported && (
            <button onClick={() => setShowType((s) => !s)} title={t('demo.typeInstead')} className={cn('flex h-12 w-12 items-center justify-center rounded-full', showType ? 'bg-accent text-accent-on' : 'bg-surface-2 text-ink-soft')}>
              <Keyboard className="h-5 w-5" />
            </button>
          )}
        </div>
        {!secure && <p className="shrink-0 px-4 pb-3 text-center text-xs text-rose-500">{t('demo.insecure')}</p>}
        {secure && !sttSupported && <p className="shrink-0 px-4 pb-3 text-center text-xs text-ink-soft">{t('demo.typeToTalk')}</p>}
      </div>
    </div>
  );
}
