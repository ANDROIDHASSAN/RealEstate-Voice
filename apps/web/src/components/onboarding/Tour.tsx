import { ArrowLeft, ArrowRight, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { speak, stopSpeaking } from '../../lib/useSpeech';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';

const STORAGE_KEY = 'cf-onboarded';

interface TourStep {
  emoji: string;
  key: string;
  /** CSS selector of the element to spotlight (null = centered welcome). */
  target: string | null;
}

const STEPS: TourStep[] = [
  { emoji: '👋', key: 'welcome', target: null },
  { emoji: '⚡', key: 'leads', target: '[data-tour="nav-leads"]' },
  { emoji: '📞', key: 'voice', target: '[data-tour="nav-voice"]' },
  { emoji: '🎯', key: 'leadEngine', target: '[data-tour="nav-lead-engine"]' },
  { emoji: '🤖', key: 'agents', target: '[data-tour="nav-agents"]' },
  { emoji: '🎙️', key: 'assistant', target: '[data-tour="assistant"]' },
  { emoji: '🌍', key: 'language', target: '[data-tour="lang"]' },
  { emoji: '🔑', key: 'keys', target: '[data-tour="nav-settings"]' },
];

export function shouldShowTour(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== '1';
}

export function resetTour(): void {
  localStorage.removeItem(STORAGE_KEY);
}

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 8; // spotlight padding around the target
const CARD_W = 340;
const GAP = 16; // gap between spotlight and card

/**
 * Guided product tour with a spotlight coach-mark: it dims the screen, cuts a
 * hole around the exact element it's describing, positions a callout next to
 * it, and narrates each step aloud (browser TTS, mutable). Falls back to a
 * centered card when a target isn't on screen.
 */
export function Tour({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [voiceOn, setVoiceOn] = useState(true);
  const voiceOnRef = useRef(true);
  voiceOnRef.current = voiceOn;

  const step = STEPS[index]!;
  const isLast = index === STEPS.length - 1;
  const title = t(`tour.${step.key}.title`);
  const body = t(`tour.${step.key}.body`);

  // Locate + track the target element (handles scroll/resize/layout shifts).
  const measure = useCallback(() => {
    if (!step.target) { setRect(null); return; }
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (!el) { setRect(null); return; }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [step.target]);

  useLayoutEffect(() => {
    measure();
    const raf = requestAnimationFrame(measure); // after any scroll settles
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [measure]);

  // Narrate the current step.
  useEffect(() => {
    stopSpeaking();
    if (voiceOnRef.current) speak(`${title}. ${body}`, i18n.language);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, voiceOn]);

  useEffect(() => () => stopSpeaking(), []);

  const finish = () => {
    stopSpeaking();
    localStorage.setItem(STORAGE_KEY, '1');
    onClose();
  };
  const go = (dir: number) => setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + dir)));

  // Position the callout card relative to the spotlight, clamped to the viewport.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let cardStyle: React.CSSProperties;
  if (rect) {
    const spotCenterX = rect.left + rect.width / 2;
    const placeRight = spotCenterX < vw / 2;
    let left = placeRight ? rect.left + rect.width + PAD + GAP : rect.left - PAD - GAP - CARD_W;
    // If neither side fits (narrow), drop below the target.
    let top = rect.top - PAD;
    if (left < 12 || left + CARD_W > vw - 12) {
      left = Math.min(Math.max(12, spotCenterX - CARD_W / 2), vw - CARD_W - 12);
      top = rect.top + rect.height + PAD + GAP;
    }
    top = Math.min(Math.max(12, top), vh - 260);
    cardStyle = { position: 'fixed', top, left, width: CARD_W };
  } else {
    cardStyle = { position: 'fixed', top: '50%', left: '50%', width: CARD_W, transform: 'translate(-50%, -50%)' };
  }

  return (
    <div className="fixed inset-0 z-[80]">
      {/* Dim + spotlight cutout (box-shadow trick), or full dim for welcome */}
      {rect ? (
        <div
          className="pointer-events-none fixed rounded-2xl ring-2 ring-white/90 transition-all duration-300"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.62)',
          }}
        >
          <span className="absolute inset-0 rounded-2xl ring-2 ring-white/70 cf-mic-live" />
        </div>
      ) : (
        <div className="fixed inset-0 bg-black/45 backdrop-blur-[2px]" />
      )}

      {/* Callout card */}
      <div className="cf-step-in rounded-card bg-surface p-6 shadow-soft" style={cardStyle}>
        <div className="flex items-start justify-between">
          <span className="text-3xl">{step.emoji}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setVoiceOn((v) => !v)}
              title={voiceOn ? t('tour.mute') : t('tour.unmute')}
              className="rounded-full p-2 text-ink-soft hover:bg-black/5"
            >
              {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
            <button onClick={finish} title={t('tour.skip')} className="rounded-full p-2 text-ink-soft hover:bg-black/5">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <h2 className="mt-3 text-lg font-bold leading-tight">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>

        <div className="mt-5 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                className={cn('h-2 rounded-pill transition-all', i === index ? 'w-6 bg-accent' : 'w-2 bg-black/10 hover:bg-black/20')}
                aria-label={`Step ${i + 1}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="secondary" size="sm" onClick={() => go(-1)} title={t('tour.back')}>
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              </Button>
            )}
            <Button size="sm" onClick={() => (isLast ? finish() : go(1))}>
              {isLast ? t('tour.done') : t('tour.next')} {!isLast && <ArrowRight className="h-4 w-4 rtl:rotate-180" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
