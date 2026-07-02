import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';

const STORAGE_KEY = 'cf-onboarded';

interface TourStep {
  emoji: string;
  titleKey: string;
  bodyKey: string;
  path?: string;
}

const STEPS: TourStep[] = [
  { emoji: '👋', titleKey: 'tour.welcome.title', bodyKey: 'tour.welcome.body' },
  { emoji: '⚡', titleKey: 'tour.leads.title', bodyKey: 'tour.leads.body', path: '/leads' },
  { emoji: '📞', titleKey: 'tour.voice.title', bodyKey: 'tour.voice.body', path: '/voice' },
  { emoji: '🎯', titleKey: 'tour.leadEngine.title', bodyKey: 'tour.leadEngine.body', path: '/lead-engine' },
  { emoji: '🤖', titleKey: 'tour.agents.title', bodyKey: 'tour.agents.body', path: '/agents' },
  { emoji: '🎙️', titleKey: 'tour.assistant.title', bodyKey: 'tour.assistant.body' },
  { emoji: '🔑', titleKey: 'tour.keys.title', bodyKey: 'tour.keys.body', path: '/settings' },
];

export function shouldShowTour(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== '1';
}

export function resetTour(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * First-login guided tour — plain-language, one idea per card, optional
 * "show me" navigation into the module being described.
 */
export function Tour({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const step = STEPS[index]!;
  const isLast = index === STEPS.length - 1;

  const finish = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-5 backdrop-blur-sm">
      <div className="cf-step-in w-full max-w-md rounded-card bg-surface p-8 shadow-soft">
        <div className="flex items-start justify-between">
          <span className="text-5xl">{step.emoji}</span>
          <button onClick={finish} className="rounded-full p-2 text-ink-soft hover:bg-black/5" title={t('tour.skip')}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <h2 className="mt-4 text-xl font-bold">{t(step.titleKey)}</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{t(step.bodyKey)}</p>

        {step.path && (
          <button
            onClick={() => {
              navigate(step.path!);
            }}
            className="mt-3 text-sm font-medium underline decoration-dotted underline-offset-4 hover:text-ink"
          >
            {t('tour.showMe')} →
          </button>
        )}

        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-2 rounded-pill transition-all ${i === index ? 'w-6 bg-accent' : 'w-2 bg-black/10'}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setIndex((i) => i - 1)}>
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              </Button>
            )}
            <Button size="sm" onClick={() => (isLast ? finish() : setIndex((i) => i + 1))}>
              {isLast ? t('tour.done') : t('tour.next')} {!isLast && <ArrowRight className="h-4 w-4 rtl:rotate-180" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
