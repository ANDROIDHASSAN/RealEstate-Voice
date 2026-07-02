import { useMutation } from '@tanstack/react-query';
import { Bot, Keyboard, Mic, MicOff, PhoneOff, Send, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { speak, stopSpeaking, useSpeech } from '../../lib/useSpeech';
import { cn } from '../../lib/utils';

interface Turn { role: 'user' | 'agent'; text: string }
type CallState = 'connecting' | 'speaking' | 'listening' | 'thinking' | 'paused';

/**
 * Live browser call — a hands-free, voice-to-voice conversation with a voice
 * agent (no phone / Vapi). The agent greets and speaks (TTS); the mic then opens
 * automatically (STT); your reply is sent to the LLM (grounded in the KB) and
 * the agent speaks back — looping like a real call. Falls back to typing when
 * the browser has no speech recognition.
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
  const pausedRef = useRef(false);
  voiceOnRef.current = voiceOn;

  // --- speech (STT) ---
  const submitRef = useRef<(text: string) => void>(() => {});
  const { supported: micSupported, listening, interim, start, stop } = useSpeech((final) => submitRef.current(final));

  const beginListening = useCallback(() => {
    if (pausedRef.current || !micSupported) { setState('paused'); return; }
    setState('listening');
    start();
  }, [micSupported, start]);

  // The agent takes a turn: show it, speak it, then open the mic.
  const agentSpeaks = useCallback((text: string) => {
    setState('speaking');
    if (voiceOnRef.current) speak(text, i18n.language, () => beginListening());
    else beginListening();
  }, [beginListening, i18n.language]);

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
    setState('thinking');
    setTurns((prev) => {
      const next: Turn[] = [...prev, { role: 'user', text: clean }];
      send.mutate(next);
      return next;
    });
  }, [send, stop]);
  submitRef.current = submit;

  // Connect: the agent greets first, then the call loop begins.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api<{ reply: string }>(`/voice-agents/${agentKey}/demo`, { method: 'POST', body: { messages: [] } })
      .then((d) => { setTurns([{ role: 'agent', text: d.reply }]); agentSpeaks(d.reply); })
      .catch(() => { const g = t('demo.fallbackGreeting'); setTurns([{ role: 'agent', text: g }]); agentSpeaks(g); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  // Call timer.
  useEffect(() => {
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Cleanup on hang up.
  const hangUp = useCallback(() => { stopSpeaking(); stop(); onClose(); }, [onClose, stop]);
  useEffect(() => () => { stopSpeaking(); }, []);

  const togglePause = () => {
    if (pausedRef.current) { pausedRef.current = false; beginListening(); }
    else { pausedRef.current = true; stop(); stopSpeaking(); setState('paused'); }
  };

  const lastAgent = [...turns].reverse().find((x) => x.role === 'agent')?.text ?? '';
  const caption = interim ? interim : state === 'listening' ? t('demo.listening') : lastAgent;
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const statusLabel = { connecting: t('demo.connecting'), speaking: t('demo.speaking'), listening: t('demo.listening'), thinking: t('demo.thinking'), paused: t('demo.paused') }[state];

  const orbClass = state === 'speaking' ? 'bg-card-purple ring-card-purple' : state === 'listening' ? 'bg-card-pink ring-card-pink cf-mic-live' : state === 'thinking' ? 'bg-card-yellow ring-card-yellow' : 'bg-surface-2 ring-black/5';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" onClick={hangUp}>
      <div className="flex h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-card bg-surface shadow-soft" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-black/5 px-5 py-4">
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
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-6">
          <div className={cn('flex h-40 w-40 items-center justify-center rounded-full ring-8 transition-colors duration-300', orbClass)}>
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-surface/70">
              {state === 'listening' ? <Mic className="h-10 w-10" /> : state === 'thinking' ? (
                <span className="flex gap-1"><span className="cf-typing-dot" /><span className="cf-typing-dot" style={{ animationDelay: '150ms' }} /><span className="cf-typing-dot" style={{ animationDelay: '300ms' }} /></span>
              ) : <Bot className="h-10 w-10" />}
            </div>
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{statusLabel}</p>
          <p className="min-h-[3.5rem] max-w-sm text-center text-lg leading-snug" dir="auto">{caption}</p>
        </div>

        {/* Transcript (compact) */}
        {turns.length > 1 && (
          <div className="max-h-24 space-y-1.5 overflow-y-auto border-t border-black/5 px-5 py-2 text-xs">
            {turns.slice(-6).map((turn, i) => (
              <p key={i} className={cn(turn.role === 'user' ? 'text-ink' : 'text-ink-soft')} dir="auto">
                <span className="font-semibold">{turn.role === 'user' ? t('demo.you') : agentName.split(' ')[0]}:</span> {turn.text}
              </p>
            ))}
          </div>
        )}

        {/* Type fallback */}
        {showType && (
          <form className="flex items-center gap-2 border-t border-black/5 px-3 py-2" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); submit(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t('demo.say')} className="h-10 min-w-0 flex-1 rounded-2xl border border-black/5 bg-surface px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ink/15" />
            <button type="submit" disabled={send.isPending || !input.trim()} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-on disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
        )}

        {/* Call controls */}
        <div className="flex items-center justify-center gap-4 border-t border-black/5 px-5 py-4">
          {micSupported ? (
            <button onClick={togglePause} title={pausedRef.current ? t('demo.resume') : t('demo.mute')}
              className={cn('flex h-12 w-12 items-center justify-center rounded-full transition-colors', state === 'paused' ? 'bg-surface-2 text-ink-soft' : 'bg-card-blue')}>
              {state === 'paused' ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
            </button>
          ) : null}
          <button onClick={hangUp} title={t('demo.hangUp')} className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-500 text-white shadow-soft transition-transform hover:scale-105">
            <PhoneOff className="h-6 w-6" />
          </button>
          <button onClick={() => setShowType((s) => !s)} title={t('demo.typeInstead')} className={cn('flex h-12 w-12 items-center justify-center rounded-full', showType ? 'bg-accent text-accent-on' : 'bg-surface-2 text-ink-soft')}>
            <Keyboard className="h-5 w-5" />
          </button>
        </div>
        {!micSupported && <p className="px-4 pb-3 -mt-2 text-center text-xs text-ink-soft">{t('demo.noMic')}</p>}
      </div>
    </div>
  );
}
