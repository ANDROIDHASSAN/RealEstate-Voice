import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PLANS } from '@closeflow/shared';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { hasModule, useAuthStore } from '../../store/auth';

/** Client-side mirror of requireModule — shows a designed upsell instead of a 403. */
export function ModuleGate({ module, children }: { module: string; children: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const account = useAuthStore((s) => s.account);

  if (hasModule(account, module)) return <>{children}</>;

  const planWithModule = Object.values(PLANS).find((p) => (p.modules as readonly string[]).includes(module));

  return (
    <Card tone="purple" className="flex flex-col items-center py-20 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface">
        <Lock className="h-6 w-6" />
      </div>
      <h2 className="text-xl font-semibold">{t('common.locked', { plan: planWithModule?.name ?? 'Pro' })}</h2>
      <p className="mt-2 max-w-sm text-sm text-ink-soft">{t('common.lockedHint')}</p>
      <Button className="mt-6" onClick={() => navigate('/billing')}>
        {t('common.upgradeCta')}
      </Button>
    </Card>
  );
}
