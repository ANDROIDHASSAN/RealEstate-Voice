import { getCrewAgent } from '@truecode/shared';
import { ChevronDown, LoaderCircle, Maximize2, Mic, Pause, Play, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentEvents, type AgentEvent } from '../../lib/agent-events';
import { AssistantStep, useAssistantCommand } from '../../lib/useAssistantCommand';
import { speak, stopSpeaking, useMicLevel, useSpeech } from '../../lib/useSpeech';
import { cn } from '../../lib/utils';

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking' | 'paused';

/**
 * Hands-free Voice Mode: tap once and drive the whole app by voice. Runs a
 * continuous loop — greet → listen → plan+execute (/assistant/command) → speak
 * the result → listen again — with barge-in (talk over the reply to interrupt).
 * A live multi-agent activity feed (SSE) shows the crew working AS you talk, and
 * a minimize/picture-in-picture mode reveals the app so you WATCH the work land.
 */
export function VoiceMode({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [phase, setPhase] = useState<Phase>('idle');
  const [minimized, setMinimized] = useState(false);
  const [heard, setHeard] = useState('');
  const [reply, setReply] = useState('');
  const [steps, setSteps] = useState<AssistantStep[]>([]);

  const activeRef = useRef(false); // session live (not paused/closed) — guards the loop
  const sessionStart = useRef(0); // ms — only show agent activity from this session

  const mic = useMicLevel();
  const micRef = useRef(mic);
  micRef.current = mic;

  // Live crew activity (SSE) — the same stream the AI Team page renders.
  const { events } = useAgentEvents();
  const sessionEvents = useMemo(
    () => events.filter((e) => new Date(e.ts).getTime() >= sessionStart.current - 1500).slice(0, 7),
    [events],
  );

  // ---- the conversational loop --------------------------------------------
  const listenAgain = useRef<() => void>(() => {});

  const command = useAssistantCommand({
    onReply: (d) => {
      if (!activeRef.current) return;
      setReply(d.reply);
      setSteps(d.steps);
      // If the plan navigated or changed data, shrink to PiP so the user SEES it.
      const acts = d.clientActions?.length ? d.clientActions : d.clientAction ? [d.clientAction] : [];
      if (acts.some((a) => a.type === 'navigate' || a.type === 'refresh' || a.type === 'orchestrate')) {
        setMinimized(true);
      }
      setPhase('speaking');
      micRef.current.arm();
      micRef.current.onSpeech(() => {
        stopSpeaking();
        listenAgain.current();
      });
      speak(d.reply, i18n.language, () => {
        micRef.current.disarm();
        if (activeRef.current) listenAgain.current();
      });
    },
    onError: () => {
      if (!activeRef.current) return;
      setReply(t('assistant.error'));
      speak(t('assistant.error'), i18n.language, () => {
        if (activeRef.current) listenAgain.current();
      });
    },
  });
  const commandRef = useRef(command);
  commandRef.current = command;

  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  const speech = useSpeech(
    (final) => {
      if (!activeRef.current) return;
      speechRef.current.stop();
      setHeard(final);
      setPhase('thinking');
      commandRef.current.mutate(final);
    },
    {
      // Silence/hiccup while we're listening → re-open the mic so the user can
      // speak the NEXT command without ever tapping. This is what makes Voice
      // Mode take unlimited back-to-back commands instead of dying after one.
      onIdleEnd: () => {
        if (!activeRef.current || commandRef.current.isPending) return;
        window.setTimeout(() => {
          if (activeRef.current && !commandRef.current.isPending && phaseRef.current === 'listening') {
            speechRef.current.start();
          }
        }, 300);
      },
    },
  );
  const speechRef = useRef(speech);
  speechRef.current = speech;

  const beginListen = useCallback(() => {
    if (!activeRef.current || commandRef.current.isPending) return;
    stopSpeaking();
    micRef.current.disarm();
    setHeard('');
    setPhase('listening');
    speechRef.current.start();
  }, []);
  listenAgain.current = beginListen;

  // ---- open / close lifecycle ---------------------------------------------
  useEffect(() => {
    if (!open) return;
    activeRef.current = true;
    sessionStart.current = Date.now();
    setMinimized(false);
    setHeard('');
    setReply('');
    setSteps([]);
    void micRef.current.ensure();
    const greeting = t('voiceMode.greeting');
    setPhase('speaking');
    setReply(greeting);
    speak(greeting, i18n.language, () => {
      if (activeRef.current) beginListen();
    });
    return () => {
      activeRef.current = false;
      speechRef.current.stop();
      stopSpeaking();
      micRef.current.disarm();
      micRef.current.stopAll();
      setPhase('idle');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pause = useCallback(() => {
    activeRef.current = false;
    speechRef.current.stop();
    stopSpeaking();
    micRef.current.disarm();
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    activeRef.current = true;
    beginListen();
  }, [beginListen]);

  if (!open) return null;

  const supported = speech.supported;
  const amp = phase === 'listening' ? Math.min(1, mic.level * 3.2) : 0;

  const statusLabel =
    phase === 'listening' ? t('voiceMode.listening')
      : phase === 'thinking' ? t('voiceMode.thinking')
        : phase === 'speaking' ? t('voiceMode.speaking')
          : phase === 'paused' ? t('voiceMode.paused')
            : t('voiceMode.ready');

  const orb = <Orb phase={phase} amp={amp} />;
  const agents = <AgentFeed events={sessionEvents} label={t('voiceMode.agentsAtWork')} idleLabel={t('voiceMode.crewIdle')} />;
  const controls = (
    <div className="flex items-center gap-2">
      {phase === 'paused' ? (
        <button onClick={resume} disabled={!supported}
          className="flex h-11 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-on transition-transform hover:scale-105 disabled:opacity-40">
          <Play className="h-4 w-4" /> {t('voiceMode.resume')}
        </button>
      ) : (
        <button onClick={pause} disabled={!supported}
          className="flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-sm font-semibold text-ink transition-transform hover:scale-105 disabled:opacity-40">
          <Pause className="h-4 w-4" /> {t('voiceMode.pause')}
        </button>
      )}
      <button onClick={onClose}
        className="flex h-11 items-center gap-2 rounded-full bg-card-pink px-4 text-sm font-semibold text-ink transition-transform hover:scale-105">
        <X className="h-4 w-4" /> {t('voiceMode.stop')}
      </button>
    </div>
  );

  // ---- Picture-in-picture dock: app is visible, voice keeps running --------
  if (minimized) {
    return (
      <div className="fixed bottom-5 z-[60] w-[min(400px,calc(100vw-2rem))] ltr:right-5 rtl:left-5 cf-overlay-in">
        <div className="cf-glass overflow-hidden rounded-card p-4">
          <div className="flex items-center gap-3">
            <div className="relative h-14 w-14 shrink-0">{orb}</div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                {phase === 'listening' && <span className="h-1.5 w-1.5 rounded-full bg-red-500 cf-live-dot" />}
                {statusLabel}
              </div>
              <p className="truncate text-sm text-ink-soft" title={heard || reply}>
                {phase === 'listening' && speech.interim ? speech.interim : heard ? `“${heard}”` : reply}
              </p>
            </div>
            <button onClick={() => setMinimized(false)} title={t('voiceMode.expand')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink hover:bg-card-blue">
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          {sessionEvents.length > 0 && <div className="mt-3">{agents}</div>}
          <div className="mt-3 flex items-center justify-between gap-2">
            {controls}
          </div>
        </div>
      </div>
    );
  }

  // ---- Full overlay --------------------------------------------------------
  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto">
      <div
        className="fixed inset-0 cf-overlay-in"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 12%, rgba(230,221,248,0.72), rgba(210,236,219,0.6) 45%, rgba(217,231,247,0.72) 100%)',
          backdropFilter: 'blur(26px) saturate(140%)',
          WebkitBackdropFilter: 'blur(26px) saturate(140%)',
        }}
        onClick={() => setMinimized(true)}
        title={t('voiceMode.tapToPreview')}
      />

      <div className="cf-overlay-in relative mx-auto flex min-h-full w-[min(560px,100%)] flex-col items-center justify-center gap-5 px-5 py-16">
        {/* top-right actions */}
        <div className="fixed top-4 flex items-center gap-2 ltr:right-4 rtl:left-4">
          <button onClick={() => setMinimized(true)} title={t('voiceMode.minimize')}
            className="flex h-11 w-11 items-center justify-center rounded-full cf-glass text-ink transition-transform hover:scale-105">
            <ChevronDown className="h-5 w-5" />
          </button>
          <button onClick={onClose} title={t('voiceMode.close')}
            className="flex h-11 w-11 items-center justify-center rounded-full cf-glass text-ink transition-transform hover:scale-105">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* orb */}
        <div className="relative flex h-44 w-44 items-center justify-center">{orb}</div>

        {/* status + transcript */}
        <div className="flex w-full flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            {phase === 'listening' && <span className="h-2 w-2 rounded-full bg-red-500 cf-live-dot" />}
            {statusLabel}
          </div>
          {heard && <p className="text-lg font-medium text-ink">“{heard}”</p>}
          {speech.interim && !heard && <p className="text-lg italic text-ink-soft">{speech.interim}</p>}
          {reply && phase !== 'listening' && <p className="max-w-md text-sm leading-relaxed text-ink-soft">{reply}</p>}
          {!supported && <p className="max-w-xs text-sm text-ink-soft">{t('voiceMode.unsupported')}</p>}
        </div>

        {/* live multi-agent activity */}
        <div className="w-[min(460px,100%)]">{agents}</div>

        {/* controls */}
        <div className="flex items-center gap-3 rounded-full cf-glass-dim px-3 py-2">{controls}</div>
        <p className="max-w-sm text-center text-xs text-ink-soft">{t('voiceMode.hint')}</p>
      </div>
    </div>
  );
}

/** The reactive glass blob orb (fills its positioned parent). */
function Orb({ phase, amp }: { phase: Phase; amp: number }) {
  const scale = 1 + amp * 0.22 + (phase === 'speaking' ? 0.05 : 0);
  return (
    <>
      {phase === 'listening' && (
        <>
          <span className="cf-ripple absolute inset-0 rounded-full border border-white/70" />
          <span className="cf-ripple absolute inset-0 rounded-full border border-white/60" style={{ animationDelay: '1.1s' }} />
        </>
      )}
      <div
        className={cn('absolute inset-[8%] rounded-full', (phase === 'speaking' || phase === 'thinking') && 'cf-orb-halo')}
        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.9), rgba(230,221,248,0) 70%)' }}
      />
      <div
        className="relative h-[86%] w-[86%] overflow-hidden rounded-full cf-glass"
        style={{ transform: `scale(${scale})`, transition: 'transform 90ms ease-out' }}
      >
        <div className={cn('cf-blob cf-blob-spin', phase !== 'listening' && 'cf-orb-breathe')}
          style={{ inset: '-12% auto auto -8%', width: '70%', height: '70%', background: 'var(--card-pink)' }} />
        <div className="cf-blob cf-blob-spin-rev"
          style={{ inset: 'auto -10% -14% auto', width: '72%', height: '72%', background: 'var(--card-purple)' }} />
        <div className="cf-blob cf-blob-spin"
          style={{ inset: 'auto auto -8% -6%', width: '58%', height: '58%', background: 'var(--card-blue)' }} />
        <div className="cf-blob cf-blob-spin-rev"
          style={{ inset: '-6% -8% auto auto', width: '52%', height: '52%', background: 'var(--card-green)' }} />
        <div className="absolute inset-0 rounded-full"
          style={{ background: 'radial-gradient(70% 55% at 32% 26%, rgba(255,255,255,0.85), rgba(255,255,255,0) 60%)' }} />
        <div className="absolute inset-0 flex items-center justify-center text-ink">
          {phase === 'thinking' ? <LoaderCircle className="h-[30%] w-[30%] animate-spin" />
            : phase === 'paused' ? <Pause className="h-[30%] w-[30%]" />
              : <Mic className="h-[30%] w-[30%]" />}
        </div>
      </div>
    </>
  );
}

/** Live crew feed — each agent event animates in as the work happens. */
function AgentFeed({ events, label, idleLabel }: { events: AgentEvent[]; label: string; idleLabel: string }) {
  return (
    <div className="cf-glass-dim rounded-2xl p-3">
      <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
        {label}
      </p>
      {events.length === 0 ? (
        <p className="px-1 pb-1 text-xs text-ink-soft">{idleLabel}</p>
      ) : (
        <div className="max-h-44 space-y-1.5 overflow-y-auto">
          {events.map((e) => {
            const agent = getCrewAgent(e.agentKey);
            const running = e.status === 'running';
            const tone =
              e.status === 'error' ? 'bg-red-500'
                : e.status === 'blocked' ? 'bg-amber-500'
                  : running ? 'bg-emerald-500' : 'bg-emerald-400';
            return (
              <div key={e.id} className="cf-step-in flex items-center gap-2.5 rounded-xl bg-white/50 px-2.5 py-1.5">
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                  {running && <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60', tone, 'cf-live-dot')} />}
                  <span className={cn('relative inline-flex h-2.5 w-2.5 rounded-full', tone)} />
                </span>
                <span className="shrink-0 text-xs font-semibold text-ink">{agent?.name ?? e.agentKey}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-soft" title={e.detail || e.title}>
                  {e.title}
                </span>
                {running && (
                  <span className="flex shrink-0 items-end gap-0.5 text-ink-soft">
                    <span className="cf-wave-bar h-2.5" style={{ animationDelay: '0ms' }} />
                    <span className="cf-wave-bar h-2.5" style={{ animationDelay: '150ms' }} />
                    <span className="cf-wave-bar h-2.5" style={{ animationDelay: '300ms' }} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
