import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cpu, Phone, PhoneCall, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { Label, Select } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { timeAgo } from '../lib/utils';

interface ProviderOption {
  var: string;
  label: string;
  choices: { value: string; label: string }[];
  value: string;
}
interface IntegrationsResponse {
  providers: { key: string; status: { name: string; live: boolean; reason?: string }; options?: ProviderOption[] }[];
}

// Which voice-pipeline dropdowns to surface right here on the Voice page.
const VOICE_ENGINE_VARS = ['VOICE_LLM_PROVIDER', 'VOICE_LLM_MODEL', 'VOICE_TTS_PROVIDER'];

/** In-call AI brain + voice selectors — writes through /integrations/voice. */
function VoiceEngineCard() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const integrations = useQuery({
    queryKey: ['integrations'],
    queryFn: () => api<IntegrationsResponse>('/integrations'),
  });
  const save = useMutation({
    mutationFn: (values: Record<string, string>) => api('/integrations/voice', { method: 'PUT', body: { values } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['integrations'] }),
  });

  const voice = integrations.data?.providers.find((p) => p.key === 'voice');
  const options = (voice?.options ?? []).filter((o) => VOICE_ENGINE_VARS.includes(o.var));

  return (
    <Card tone="blue">
      <div className="mb-1 flex items-center gap-2">
        <Cpu className="h-5 w-5" />
        <CardTitle>{t('voice.engine')}</CardTitle>
        {voice && (
          <Badge tone={voice.status.live ? 'green' : 'yellow'} className="ms-auto">
            {voice.status.live ? voice.status.name : t('settings.needsKey')}
          </Badge>
        )}
      </div>
      <CardDescription className="mb-4">{t('voice.engineHint')}</CardDescription>
      {integrations.isLoading ? (
        <p className="text-sm text-ink-soft">{t('common.loading')}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          {options.map((o) => (
            <div key={o.var}>
              <Label className="flex items-center gap-1.5">
                {o.var === 'VOICE_LLM_PROVIDER' && <Sparkles className="h-3.5 w-3.5" />}
                {o.label}
              </Label>
              <Select
                defaultValue={o.value}
                disabled={save.isPending}
                onChange={(e) => save.mutate({ [o.var]: e.target.value })}
              >
                {o.choices.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

interface AgentCfg {
  key: string;
  name: string;
  language: string;
  purpose: string;
  status: 'live' | 'ready';
}

interface CallRow {
  _id: string;
  agentKey: string;
  status: string;
  outcome?: string;
  durationSec: number;
  summary?: string;
  transcript?: { role: string; text: string; ts: number }[];
  createdAt: string;
  leadId?: { firstName?: string; lastName?: string; locale?: string };
}

const langFlag: Record<string, string> = { en: '🇺🇸', es: '🇪🇸', ar: '🇸🇦', pt: '🇧🇷', ht: '🇭🇹' };

export default function Voice() {
  const { t } = useTranslation();
  const [openCall, setOpenCall] = useState<string | null>(null);

  const agents = useQuery({ queryKey: ['voice-agents'], queryFn: () => api<{ agents: AgentCfg[] }>('/calls/agents') });
  const calls = useQuery({
    queryKey: ['calls'],
    queryFn: () => api<{ items: CallRow[] }>('/calls'),
    refetchInterval: 5000,
  });
  const outcomes = useQuery({
    queryKey: ['call-outcomes'],
    queryFn: () => api<{ outcomes: { outcome: string; count: number }[] }>('/stats/calls'),
    refetchInterval: 10000,
  });

  if (agents.isLoading || calls.isLoading) return <PageSkeleton />;
  if (agents.isError || calls.isError) return <ErrorState onRetry={() => void calls.refetch()} />;

  const items = calls.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title={t('voice.title')} subtitle={t('voice.subtitle')} />

      <VoiceEngineCard />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle className="mb-1">{t('voice.outcomes')}</CardTitle>
          <CardDescription className="mb-6">M2</CardDescription>
          {(outcomes.data?.outcomes.length ?? 0) === 0 ? (
            <p className="py-10 text-center text-sm text-ink-soft">{t('voice.noCalls')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={outcomes.data!.outcomes} barSize={30}>
                <XAxis dataKey="outcome" axisLine={false} tickLine={false} fontSize={12} stroke="#6B6B6B" />
                <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} />
                <Bar dataKey="count" radius={[10, 10, 10, 10]}>
                  {outcomes.data!.outcomes.map((row, i) => (
                    <Cell key={i} fill={row.outcome === 'booked' ? '#D2ECDB' : row.outcome === 'qualified' ? '#E6DDF8' : '#FCEBCB'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card tone="purple" className="max-h-[320px] overflow-y-auto">
          <CardTitle className="mb-4">20 agents</CardTitle>
          <ul className="space-y-2.5">
            {(agents.data?.agents ?? []).map((a) => (
              <li key={a.key} className="flex items-center gap-2 text-sm">
                <span>{langFlag[a.language] ?? '🌐'}</span>
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <Badge tone={a.status === 'live' ? 'green' : 'neutral'}>{a.status === 'live' ? t('voice.live') : t('voice.ready')}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardTitle className="mb-4">{t('voice.recentCalls')}</CardTitle>
        {items.length === 0 ? (
          <EmptyState icon={Phone} title={t('voice.noCalls')} hint={t('voice.noCallsHint')} />
        ) : (
          <ul className="divide-y divide-black/5">
            {items.map((call) => (
              <li key={call._id} className="py-3">
                <button className="flex w-full items-center gap-4 text-start" onClick={() => setOpenCall(openCall === call._id ? null : call._id)}>
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-card-green">
                    <PhoneCall className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {call.leadId?.firstName} {call.leadId?.lastName}
                      <span className="ms-2 text-xs text-ink-soft">{call.agentKey}</span>
                    </p>
                    <p className="truncate text-xs text-ink-soft">{call.summary ?? call.status}</p>
                  </div>
                  <span className="text-xs text-ink-soft">{Math.round(call.durationSec / 60)}m {call.durationSec % 60}s</span>
                  <Badge tone={call.outcome === 'booked' ? 'green' : call.status === 'blocked' ? 'pink' : 'neutral'} className="capitalize">
                    {call.outcome ?? call.status}
                  </Badge>
                  <span className="text-xs text-ink-soft">{timeAgo(call.createdAt)}</span>
                </button>
                {openCall === call._id && call.transcript && call.transcript.length > 0 && (
                  <div className="ms-14 mt-3 space-y-2 rounded-2xl bg-surface-2 p-4">
                    <p className="text-xs font-medium text-ink-soft">{t('voice.transcript')}</p>
                    {call.transcript.map((turn, i) => (
                      <p key={i} className="text-sm" dir="auto">
                        <span className={turn.role === 'agent' ? 'font-semibold' : 'text-ink-soft'}>
                          {turn.role === 'agent' ? '🤖' : '👤'}
                        </span>{' '}
                        {turn.text}
                      </p>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
