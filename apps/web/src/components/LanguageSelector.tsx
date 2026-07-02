import { Globe } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { setLocale } from '../lib/i18n';
import { cn } from '../lib/utils';

const LANGUAGES: { code: string; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'ht', label: 'Kreyòl Ayisyen', flag: '🇭🇹' },
];

/** Top-right language switcher — instant UI switch + persisted on the account. */
export function LanguageSelector() {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0]!;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const choose = (code: string) => {
    setLocale(code);
    setOpen(false);
    void api('/account/me', { method: 'PATCH', body: { locale: code } }).catch(() => undefined);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 items-center gap-2 rounded-pill bg-surface px-3.5 text-sm font-medium shadow-soft transition-colors hover:bg-surface-2"
        title={current.label}
      >
        <Globe className="h-4 w-4 text-ink-soft" />
        <span>{current.flag}</span>
        <span className="hidden uppercase sm:inline">{current.code}</span>
      </button>
      {open && (
        <div className="absolute top-12 z-50 w-48 overflow-hidden rounded-2xl bg-surface p-1.5 shadow-soft ltr:right-0 rtl:left-0">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              onClick={() => choose(l.code)}
              className={cn(
                'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start text-sm transition-colors hover:bg-surface-2',
                l.code === i18n.language && 'bg-card-purple font-semibold',
              )}
            >
              <span className="text-base">{l.flag}</span>
              <span>{l.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
