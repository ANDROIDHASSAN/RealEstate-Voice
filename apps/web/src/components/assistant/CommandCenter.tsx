import { useQuery } from '@tanstack/react-query';
import { AudioLines, Bot, Mic, Send, Sparkles, Volume2, VolumeX, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { AssistantStep, useAssistantCommand } from '../../lib/useAssistantCommand';
import { speak, useSpeech } from '../../lib/useSpeech';
import { cn } from '../../lib/utils';
import { Badge } from '../ui/badge';
import { VoiceMode } from './VoiceMode';

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  steps?: AssistantStep[];
}

/**
 * Global assistant: type or SPEAK a command from any module — the LLM plans,
 * the API executes through the same queue + ComplianceGuard paths as the UI,
 * and the steps render live so the user watches the agents work.
 */
export function CommandCenter() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [input, setInput] = useState('');
  const [voiceReplies, setVoiceReplies] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // The assistant knows the whole account — fetch a live snapshot when opened.
  const context = useQuery({
    queryKey: ['assistant-context'],
    queryFn: () => api<{ context: { totalLeads: number; leadsThisWeek: number; appointmentsThisWeek: number } }>('/assistant/context'),
    enabled: open,
    staleTime: 30_000,
  });

  const command = useAssistantCommand({
    onReply: (d) => {
      setMessages((prev) => [...prev, { role: 'assistant', text: d.reply, steps: d.steps }]);
      if (voiceReplies) speak(d.reply, i18n.language);
    },
    onError: () => {
      setMessages((prev) => [...prev, { role: 'assistant', text: t('assistant.error') }]);
    },
  });

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || command.isPending) return;
    setMessages((prev) => [...prev, { role: 'user', text: trimmed }]);
    setInput('');
    command.mutate(trimmed);
  };

  const { supported, listening, interim, start, stop } = useSpeech((final) => {
    setOpen(true);
    submit(final);
  });

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, command.isPending]);

  // Alt+K opens the typed assistant, Alt+V drops into hands-free Voice Mode.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setVoiceOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <>
      {/* Floating launcher — hands-free Voice Mode + the typed assistant */}
      <div className="fixed bottom-24 z-50 flex flex-col items-end gap-3 ltr:right-5 rtl:left-5 md:bottom-6">
        {supported && (
          <button
            onClick={() => setVoiceOpen(true)}
            title={`${t('voiceMode.launch')} (Alt+V)`}
            data-tour="voice-mode"
            className="group relative flex h-14 w-14 items-center justify-center rounded-full text-ink shadow-soft transition-transform hover:scale-105"
            style={{ background: 'linear-gradient(135deg, var(--card-purple), var(--card-blue))' }}
          >
            <span className="absolute inset-0 rounded-full cf-mic-live opacity-0 group-hover:opacity-100" />
            <AudioLines className="h-6 w-6" />
          </button>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          title={`${t('assistant.title')} (Alt+K)`}
          data-tour="assistant"
          className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-on shadow-soft transition-transform hover:scale-105"
        >
          {open ? <X className="h-6 w-6" /> : <Sparkles className="h-6 w-6" />}
        </button>
      </div>

      <VoiceMode open={voiceOpen} onClose={() => setVoiceOpen(false)} />

      {open && (
        <div className="fixed bottom-40 z-50 flex max-h-[70vh] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-card bg-surface shadow-soft ltr:right-5 rtl:left-5 md:bottom-24">
          <div className="flex items-center gap-2 border-b border-black/5 px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-card-purple">
              <Bot className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t('assistant.title')}</p>
              <p className="truncate text-xs text-ink-soft">{t('assistant.subtitle')}</p>
            </div>
            <button
              onClick={() => setVoiceReplies((v) => !v)}
              title={t('assistant.speakReplies')}
              className="rounded-full p-2 text-ink-soft hover:bg-black/5"
            >
              {voiceReplies ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {messages.length === 0 && (
              <div className="space-y-2">
                {context.data && (
                  <div className="rounded-2xl bg-card-green px-4 py-3 text-sm">
                    {t('assistant.snapshot', {
                      total: context.data.context.totalLeads,
                      week: context.data.context.leadsThisWeek,
                      appts: context.data.context.appointmentsThisWeek,
                    })}
                  </div>
                )}
                <p className="text-sm text-ink-soft">{t('assistant.intro')}</p>
                {[t('assistant.example1'), t('assistant.example2'), t('assistant.example3')].map((ex) => (
                  <button
                    key={ex}
                    onClick={() => submit(ex)}
                    className="block w-full rounded-2xl bg-surface-2 px-4 py-2.5 text-start text-sm hover:bg-card-blue"
                  >
                    “{ex}”
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={cn('max-w-[90%]', m.role === 'user' ? 'ms-auto' : '')}>
                <div
                  className={cn(
                    'rounded-2xl px-4 py-2.5 text-sm',
                    m.role === 'user' ? 'bg-accent text-accent-on' : 'bg-surface-2 text-ink',
                  )}
                >
                  {m.text}
                </div>
                {m.steps && m.steps.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {m.steps.map((s, j) => (
                      <div key={j} className="cf-step-in flex items-center gap-2 text-xs text-ink-soft" style={{ animationDelay: `${j * 220}ms` }}>
                        <Badge tone={s.status === 'done' ? 'green' : s.status === 'blocked' ? 'yellow' : 'pink'}>{s.agentKey}</Badge>
                        <span className="min-w-0 flex-1 truncate" title={s.detail}>{s.title}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {(command.isPending || interim) && (
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <span className="cf-typing-dot" />
                <span className="cf-typing-dot" style={{ animationDelay: '150ms' }} />
                <span className="cf-typing-dot" style={{ animationDelay: '300ms' }} />
                {interim && <span className="italic">“{interim}”</span>}
              </div>
            )}
          </div>

          <form
            className="flex items-center gap-2 border-t border-black/5 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            {supported && (
              <button
                type="button"
                onClick={() => (listening ? stop() : start())}
                className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                  listening ? 'cf-mic-live bg-card-pink' : 'bg-surface-2 hover:bg-card-blue',
                )}
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('assistant.placeholder')}
              className="h-10 min-w-0 flex-1 rounded-2xl border border-black/5 bg-surface px-4 text-sm focus:outline-none focus:ring-2 focus:ring-ink/15"
            />
            <button
              type="submit"
              disabled={command.isPending || !input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-on disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
