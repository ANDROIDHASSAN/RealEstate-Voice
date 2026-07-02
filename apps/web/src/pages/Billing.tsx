import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { useAuthStore, userCan, type SessionAccount } from '../store/auth';

interface Plan {
  key: string;
  name: string;
  priceMonthly: number;
  modules: string[];
}

const MODULE_LABELS: Record<string, string> = {
  core: 'Core dashboard & CRM',
  instantReply: 'Instant Reply (<60s)',
  analytics: 'Analytics & charts',
  voice: 'AI Voice agents',
  followup: 'Follow-up autopilot',
  whatsapp: 'WhatsApp automation',
  leadEngine: 'Lead Engine (scraping)',
  instagram: 'Instagram automation',
  website: 'Website / IDX',
  content: 'Content & video studio',
  multiAgent: 'Multi-agent AI team',
  propertyIntel: 'Property Intelligence',
  quotations: 'Quotations & proposals',
  invoicing: 'Invoicing & payments',
  deals: 'Deal pipeline',
  ledger: 'Commission & expense ledger',
  documents: 'Documents & e-sign',
  cms: 'Website CMS',
};

const tones = ['pink', 'yellow', 'green'] as const;
const planTone = (key: string, i: number) => (key === 'ultimate' ? 'purple' : tones[i % 3]);

export default function Billing() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { account, user, setAccount } = useAuthStore();
  const canBill = userCan(user, 'account:billing');

  const plans = useQuery({ queryKey: ['plans'], queryFn: () => api<{ plans: Plan[] }>('/billing/plans') });
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<{ usage: { type: string; total: number }[] }>('/billing/usage') });

  const subscribe = useMutation({
    mutationFn: (plan: string) =>
      api<{ mock?: boolean; checkoutUrl?: string; account?: SessionAccount }>('/billing/subscribe', {
        method: 'POST',
        body: { plan },
      }),
    onSuccess: (d) => {
      if (d.checkoutUrl) {
        window.location.href = d.checkoutUrl;
        return;
      }
      if (d.account) setAccount(d.account);
      void qc.invalidateQueries();
    },
  });

  if (plans.isLoading) return <PageSkeleton />;
  if (plans.isError) return <ErrorState onRetry={() => void plans.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('billing.title')} subtitle={t('billing.subtitle')} />
      <p className="rounded-2xl bg-card-yellow px-5 py-3 text-sm">{t('billing.mockNote')}</p>
      {!canBill && <p className="rounded-2xl bg-card-pink px-5 py-3 text-sm">{t('billing.noPermission')}</p>}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {(plans.data?.plans ?? []).map((plan, i) => {
          const current = account?.plan === plan.key;
          return (
            <Card key={plan.key} tone={planTone(plan.key, i)} className="flex flex-col">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">{plan.name}</CardTitle>
                {current ? <Badge tone="ink">{t('billing.current')}</Badge> : plan.key === 'ultimate' ? <Badge tone="ink">★ {t('billing.everything')}</Badge> : null}
              </div>
              <p className="mt-3 text-4xl font-semibold">
                ${plan.priceMonthly}
                <span className="text-base font-normal text-ink-soft">/mo{plan.key === 'empire' || plan.key === 'ultimate' ? '+' : ''}</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {plan.modules.map((m) => (
                  <li key={m} className="flex items-center gap-2 text-sm">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface/80">
                      <Check className="h-3 w-3" />
                    </span>
                    {MODULE_LABELS[m] ?? m}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-6 w-full"
                variant={current ? 'secondary' : 'primary'}
                disabled={current || subscribe.isPending || !canBill}
                onClick={() => subscribe.mutate(plan.key)}
              >
                {current ? '✓' : t('billing.subscribe')}
              </Button>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardTitle className="mb-4">{t('billing.usage')}</CardTitle>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {['voiceMinutes', 'smsSegments', 'leadCredits', 'aiTokens'].map((type) => {
            const row = usage.data?.usage.find((u) => u.type === type);
            return (
              <div key={type} className="rounded-2xl bg-surface-2 p-4">
                <p className="text-2xl font-semibold">{row?.total ?? 0}</p>
                <p className="text-xs text-ink-soft">{type}</p>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
