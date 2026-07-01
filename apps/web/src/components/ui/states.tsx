import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';
import { Card } from './card';

/** Designed empty state — icon tile, title, hint, optional action. */
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col items-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-card-purple">
        <Icon className="h-6 w-6 text-ink" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {hint && <p className="mt-2 max-w-md text-sm text-ink-soft">{hint}</p>}
      {action && <div className="mt-6">{action}</div>}
    </Card>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Card tone="pink" className="flex flex-col items-center py-12 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-ink" />
      <h3 className="font-semibold">{t('common.error')}</h3>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" /> {t('common.retry')}
        </Button>
      )}
    </Card>
  );
}
