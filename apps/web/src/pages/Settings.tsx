import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, ExternalLink, KeyRound, ShieldCheck } from 'lucide-react';
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
import { cn } from '../lib/utils';
import { useAuthStore, type SessionAccount } from '../store/auth';

interface ProviderField {
  var: string;
  label: string;
  secret: boolean;
  configured: boolean;
  maskedValue: string;
}

interface ProviderRow {
  key: string;
  name: string;
  docsUrl: string;
  status: { name: string; live: boolean; reason?: string };
  fields: ProviderField[];
}

interface ComplianceDoc {
  tcpaConsent: boolean;
  quietHours: { start: number; end: number };
  dncList: string[];
}

/** One expandable provider row: status badge + editable key fields. */
function ProviderPanel({ provider }: { provider: ProviderRow }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: () => api(`/integrations/${provider.key}`, { method: 'PUT', body: { values } }),
    onSuccess: () => {
      setValues({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      void qc.invalidateQueries({ queryKey: ['integrations'] });
      void qc.invalidateQueries({ queryKey: ['providers'] });
    },
  });

  const dirty = Object.values(values).some((v) => v.trim().length > 0);

  return (
    <li className="rounded-2xl bg-surface-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-start text-sm"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{provider.name}</span>
        {provider.status.live ? (
          <Badge tone="green">
            <CheckCircle2 className="h-3 w-3" /> {t('settings.connected')}
          </Badge>
        ) : (
          <Badge tone="yellow" title={provider.status.reason}>
            {t('settings.needsKey')}
          </Badge>
        )}
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-ink-soft transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <form
          className="space-y-3 border-t border-black/5 px-4 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) save.mutate();
          }}
        >
          {provider.fields.map((f) => (
            <div key={f.var}>
              <Label className="flex items-center justify-between">
                <span>{f.label}</span>
                {f.configured && <span className="text-xs font-normal text-ink-soft">{f.maskedValue}</span>}
              </Label>
              <Input
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                placeholder={f.configured ? t('settings.keySet') : t('settings.pasteKey')}
                value={values[f.var] ?? ''}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.var]: e.target.value }))}
              />
            </div>
          ))}
          <div className="flex items-center justify-between gap-3">
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-xs text-ink-soft underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              {t('settings.whereKey')} <ExternalLink className="h-3 w-3" />
            </a>
            <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
              {saved ? `✓ ${t('common.save')}d` : save.isPending ? '…' : t('common.save')}
            </Button>
          </div>
          {save.isError && <p className="text-xs text-red-600">{t('common.error')}</p>}
        </form>
      )}
    </li>
  );
}

export default function Settings() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const { account, setAccount } = useAuthStore();
  const [dncEntry, setDncEntry] = useState('');

  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api<{ providers: ProviderRow[] }>('/integrations'),
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

  if (integrations.isLoading || compliance.isLoading) return <PageSkeleton />;
  if (integrations.isError) return <ErrorState onRetry={() => void integrations.refetch()} />;
  const c = compliance.data?.compliance;

  return (
    <div className="space-y-6">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Integrations — configure API keys right here */}
        <Card>
          <div className="mb-1 flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            <CardTitle>{t('settings.providers')}</CardTitle>
          </div>
          <CardDescription className="mb-4">{t('settings.providersHint')}</CardDescription>
          <ul className="space-y-2.5">
            {(integrations.data?.providers ?? []).map((p) => (
              <ProviderPanel key={p.key} provider={p} />
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
