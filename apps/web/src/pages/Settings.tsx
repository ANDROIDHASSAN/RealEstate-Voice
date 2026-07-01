import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { setLocale } from '../lib/i18n';
import { useAuthStore, type SessionAccount } from '../store/auth';

interface ProviderInfo {
  name: string;
  live: boolean;
  reason?: string;
}

interface ComplianceDoc {
  tcpaConsent: boolean;
  quietHours: { start: number; end: number };
  dncList: string[];
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { account, setAccount } = useAuthStore();
  const [dncEntry, setDncEntry] = useState('');

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<{ providers: ProviderInfo[] }>('/account/providers'),
  });
  const compliance = useQuery({
    queryKey: ['compliance'],
    queryFn: () => api<{ compliance: ComplianceDoc }>('/account/compliance'),
  });

  const patchCompliance = useMutation({
    mutationFn: (body: Record<string, unknown>) => api('/account/compliance', { method: 'PATCH', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['compliance'] }),
  });

  const patchAccount = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ account: SessionAccount }>('/account/me', { method: 'PATCH', body }),
    onSuccess: (d) => setAccount(d.account),
  });

  if (providers.isLoading || compliance.isLoading) return <PageSkeleton />;
  if (providers.isError) return <ErrorState onRetry={() => void providers.refetch()} />;
  const c = compliance.data?.compliance;

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Providers board */}
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            <CardTitle>{t('settings.providers')}</CardTitle>
          </div>
          <ul className="space-y-2.5">
            {(providers.data?.providers ?? []).map((p) => (
              <li key={p.name} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                {p.live ? (
                  <Badge tone="green">
                    <CheckCircle2 className="h-3 w-3" /> {t('settings.connected')}
                  </Badge>
                ) : (
                  <Badge tone="yellow" title={p.reason}>
                    {t('settings.needsKey')}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-5">
          {/* Language */}
          <Card tone="purple">
            <CardTitle className="mb-3">{t('settings.language')}</CardTitle>
            <Select
              value={i18n.language}
              onChange={(e) => {
                setLocale(e.target.value);
                patchAccount.mutate({ locale: e.target.value });
              }}
            >
              <option value="en">English</option>
              <option value="es">Español</option>
              <option value="ar">العربية (RTL)</option>
              <option value="pt">Português</option>
              <option value="ht">Kreyòl Ayisyen</option>
            </Select>
          </Card>

          {/* Compliance */}
          <Card tone="green">
            <div className="mb-1 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" />
              <CardTitle>{t('settings.compliance')}</CardTitle>
            </div>
            <CardDescription className="mb-4">TCPA · DNC · {t('settings.quietHours')}</CardDescription>
            {c && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('settings.quietHours')} — start</Label>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={c.quietHours.start}
                      onBlur={(e) =>
                        patchCompliance.mutate({ quietHours: { start: Number(e.target.value), end: c.quietHours.end } })
                      }
                    />
                  </div>
                  <div>
                    <Label>end</Label>
                    <Input
                      type="number"
                      min={1}
                      max={24}
                      defaultValue={c.quietHours.end}
                      onBlur={(e) =>
                        patchCompliance.mutate({ quietHours: { start: c.quietHours.start, end: Number(e.target.value) } })
                      }
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <Label>{t('settings.dncList')}</Label>
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (dncEntry.trim()) {
                        patchCompliance.mutate({ addDnc: dncEntry.trim() });
                        setDncEntry('');
                      }
                    }}
                  >
                    <Input placeholder="+1305…" value={dncEntry} onChange={(e) => setDncEntry(e.target.value)} />
                    <Button type="submit" variant="secondary" size="md">
                      +
                    </Button>
                  </form>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {c.dncList.map((n) => (
                      <Badge key={n} tone="pink" className="cursor-pointer" onClick={() => patchCompliance.mutate({ removeDnc: n })}>
                        {n} ✕
                      </Badge>
                    ))}
                  </div>
                </div>
              </>
            )}
          </Card>

          {/* Account */}
          <Card>
            <CardTitle className="mb-3">{account?.name}</CardTitle>
            <p className="text-sm text-ink-soft">{account?.email}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {t('billing.current')}: <span className="font-medium capitalize text-ink">{account?.plan}</span>
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
