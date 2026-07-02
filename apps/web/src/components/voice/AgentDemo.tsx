import { useMutation } from '@tanstack/react-query';
import { Bot, Mic, Phone, Send, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { speak, useSpeech } from '../../lib/useSpeech';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';

interface Turn { role: 'user' | 'agent'; text: string }

/**
 * Browser demo — hold a live conversation with a voice agent from the laptop
 * (no phone / Vapi). Type or speak; the agent replies via the LLM grounded in
 * the knowledge base, and speaks back with the browser's speech synthesis.
 */
export function AgentDemo({ agentKey, agentName, onClose }: { agentKey: string; agentName: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [voiceOn, setVoiceOn] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const send = useMutation({
    mutationFn: (messages: Turn[]) => api<{ reply: string }>(`/voice-agents/${agentKey}/demo`, { method: 'POST', body: { messages } }),
    onSuccess: (d) => {
      setTurns((prev) => [...prev, { role: 'agent', text: d.reply }]);
      if (voiceOn) speak(d.reply, i18n.language);
    },
  });

  // Agent speaks first when the demo opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void api<{ reply: string }>(`/voice-agents/${agentKey}/demo`, { method: 'POST', body: { messages: [] } })
      .then((d) => {
        setTurns([{ role: 'agent', text: d.reply }]);
        if (voiceOn) speak(d.reply, i18n.language);
      })
      .catch(() => setTurns([{ role: 'agent', text: 'Hello! Thanks for taking my call.' }]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, send.isPending]);

  const submit = (text: string) => {
    const clean = text.trim();
    if (!clean || send.isPending) return;
    const next: Turn[] = [...turns, { role: 'user', text: clean }];
    setTurns(next);
    setInput('');
    send.mutate(next);
  };

  const { supported, listening, interim, start, stop } = useSpeech((final) => submit(final));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-card bg-surface shadow-soft" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-black/5 px-5 py-4">
          <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-card-purple">
            <Bot className="h-6 w-6" />
            <span className="absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-card-green">
              <Phone className="h-2.5 w-2.5" />
            </span>
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{agentName}</p>
            <p className="flex items-center gap-1.5 text-xs text-ink-soft">
              <span className="h-2 w-2 rounded-full bg-green-500 cf-live-dot" /> {t('demo.onCall')}
            </p>
          </div>
          <button onClick={() => setVoiceOn((v) => !v)} title={t('demo.speak')} className="rounded-full p-2 text-ink-soft hover:bg-black/5">
            {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button onClick={onClose} className="rounded-full p-2 text-ink-soft hover:bg-card-pink" title={t('demo.hangUp')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Conversation */}
        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {turns.map((turn, i) => (
            <div key={i} className={cn('max-w-[85%]', turn.role === 'user' ? 'ms-auto' : '')}>
              <div className={cn('rounded-2xl px-4 py-2.5 text-sm', turn.role === 'user' ? 'bg-accent text-accent-on' : 'bg-surface-2 text-ink')} dir="auto">
                {turn.text}
              </div>
            </div>
          ))}
          {(send.isPending || interim) && (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              {interim ? <span className="italic">“{interim}”</span> : (
                <>
                  <span className="cf-typing-dot" />
                  <span className="cf-typing-dot" style={{ animationDelay: '150ms' }} />
                  <span className="cf-typing-dot" style={{ animationDelay: '300ms' }} />
                </>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <form className="flex items-center gap-2 border-t border-black/5 p-3" onSubmit={(e) => { e.preventDefault(); submit(input); }}>
          {supported && (
            <button
              type="button"
              onClick={() => (listening ? stop() : start())}
              className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors', listening ? 'cf-mic-live bg-card-pink' : 'bg-surface-2 hover:bg-card-blue')}
              title={t('demo.hold')}
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('demo.say')}
            className="h-11 min-w-0 flex-1 rounded-2xl border border-black/5 bg-surface px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ink/15"
          />
          <button type="submit" disabled={send.isPending || !input.trim()} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-on disabled:opacity-40">
            <Send className="h-5 w-5" />
          </button>
        </form>
        {!supported && <p className="px-4 pb-3 -mt-1 text-center text-xs text-ink-soft">{t('demo.noMic')}</p>}
        <div className="px-4 pb-3 -mt-1 text-center">
          <Badge tone="neutral">{t('demo.badge')}</Badge>
        </div>
      </div>
    </div>
  );
}
