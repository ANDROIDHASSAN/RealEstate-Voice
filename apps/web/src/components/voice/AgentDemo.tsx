import { useMutation } from '@tanstack/react-query';
import { Bot, Keyboard, Mic, PhoneOff, Send, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { speak, stopSpeaking, useSpeech } from '../../lib/useSpeech';
import { cn } from '../../lib/utils';

interface Turn { role: 'user' | 'agent'; text: string }
type CallState = 'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * Live browser call — talk to a voice agent with no phone / Vapi.
 *
 * PUSH-TO-TALK by design: the agent speaks its turn, then WAITS. You tap the mic
 * to reply; the mic is never open while (or right after) the agent is speaking,
 * so it can't hear its own TTS through the speakers and talk to itself. This
 * kills the echo/hallucination loop that "hands-free" auto-listen causes without
 * hardware echo cancellation. Degrades to typing where speech recognition is
 * unavailable (e.g. iOS Safari).
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
  voiceOnRef.current = voiceOn;
  stateRef.current = state;

  const secure = typeof window === 'undefined' || window.isSecureContext;
  const submitRef = useRef<(text: string) => void>(() => {});
  const { supported: sttSupported, listening, interim, start, stop } = useSpeech((final) => submitRef.current(final));

  const setCall = (s: CallState) => { stateRef.current = s; setState(s); };

  // The agent takes a turn: speak it, then WAIT for the user (no auto-listen).
  const agentSpeaks = useCallback((text: string) => {
    setCall('speaking');
    if (voiceOnRef.current) speak(text, i18n.language, () => { if (stateRef.current === 'speaking') setCall('idle'); });
    else setCall('idle');
  }, [i18n.language]);

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

  // User taps the mic to speak. Always stop the agent's audio first so the mic
  // never captures TTS.
  const startListening = useCallback(() => {
    if (!sttSupported) return;
    stopSpeaking();
    setCall('listening');
    start();
  }, [sttSupported, start]);

  const stopListening = useCallback(() => {
    stop();
    if (stateRef.current === 'listening') setCall('idle');
  }, [stop]);

  // Connect: the agent greets and speaks, then waits for you to tap the mic.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<{ reply: string }>(`/voice-agents/${agentKey}/demo`, { method: 'POST', body: { messages: [] } })
      .then((d) => { setTurns([{ role: 'agent', text: d.reply }]); agentSpeaks(d.reply); })
      .catch(() => { const g = t('demo.fallbackGreeting'); setTurns([{ role: 'agent', text: g }]); agentSpeaks(g); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const hangUp = useCallback(() => { stopSpeaking(); stop(); onClose(); }, [onClose, stop]);
  useEffect(() => () => { stopSpeaking(); }, []);

  // Primary control (orb + mic button): interrupt while speaking, else toggle mic.
  const onMicControl = () => {
    if (state === 'speaking') { stopSpeaking(); setCall('idle'); return; }
    if (state === 'listening') stopListening();
    else startListening();
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
