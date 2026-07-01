import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Play } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CREW_AGENTS } from '@closeflow/shared';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { timeAgo } from '../lib/utils';

interface RunRow {
  _id: string;
  agentKey: string;
  status: string;
  nextAction?: { type: string; reasoning?: string };
  output?: { source?: string };
  createdAt: string;
}

interface LeadOption {
  _id: string;
  firstName: string;
  lastName?: string;
  status: string;
}

export default function Agents() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState('');
  const [goal, setGoal] = useState('Book a qualified appointment');
  const [lastResult, setLastResult] = useState<{ action?: { type: string; reasoning: string; agentPath: string[] }; source?: string } | null>(null);

  const leads = useQuery({ queryKey: ['leads', 'options'], queryFn: () => api<{ items: LeadOption[] }>('/leads?limit=50') });
  const runs = useQuery({ queryKey: ['agent-runs'], queryFn: () => api<{ items: RunRow[] }>('/orchestrator/runs'), refetchInterval: 8000 });

  const run = useMutation({
    mutationFn: () =>
      api<{ action: { type: string; reasoning: string; agentPath: string[] }; source: string }>('/orchestrator/run', {
        method: 'POST',
        body: { leadId, goal },
      }),
    onSuccess: (d) => {
      setLastResult(d);
      void qc.invalidateQueries({ queryKey: ['agent-runs'] });
    },
  });

  if (leads.isLoading) return <PageSkeleton />;
  if (leads.isError) return <ErrorState onRetry={() => void leads.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('agents.title')} subtitle={t('agents.subtitle')} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card tone="blue" className="lg:col-span-3">
          <CardTitle className="mb-4">{t('agents.run')}</CardTitle>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (leadId) run.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Lead</Label>
                <Select required value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                  <option value="">—</option>
                  {(leads.data?.items ?? []).map((l) => (
                    <option key={l._id} value={l._id}>
                      {l.firstName} {l.lastName} ({l.status})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>{t('agents.goal')}</Label>
                <Input required value={goal} onChange={(e) => setGoal(e.target.value)} />
              </div>
            </div>
            <Button type="submit" disabled={run.isPending || !leadId}>
              <Play className="h-4 w-4" /> {run.isPending ? '…' : t('agents.run')}
            </Button>
          </form>

          {lastResult?.action && (
            <div className="mt-6 rounded-2xl bg-surface p-5">
              <div className="flex items-center gap-2">
                <Badge tone="ink">{t('agents.action')}: {lastResult.action.type}</Badge>
                <Badge tone={lastResult.source === 'crewai' ? 'green' : 'yellow'}>
                  {lastResult.source === 'crewai' ? 'CrewAI' : 'TS fallback'}
                </Badge>
              </div>
              <p className="mt-3 text-sm text-ink-soft">{lastResult.action.reasoning}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                {lastResult.action.agentPath.map((a, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    {i > 0 && <span>→</span>}
                    <span className="rounded-pill bg-card-purple px-2.5 py-0.5">{a}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card className="max-h-[420px] overflow-y-auto lg:col-span-2">
          <CardTitle className="mb-4">20 agents</CardTitle>
          <ul className="space-y-2.5">
            {CREW_AGENTS.map((a) => (
              <li key={a.key} className="flex items-center gap-2 text-sm">
                <Bot className="h-4 w-4 shrink-0 text-ink-soft" />
                <span className="min-w-0 flex-1 truncate" title={a.goal}>
                  {a.name}
                </span>
                <Badge tone={a.status === 'live' ? 'green' : 'neutral'}>{a.status}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardTitle className="mb-4">{t('agents.recentRuns')}</CardTitle>
        <ul className="divide-y divide-black/5 text-sm">
          {(runs.data?.items ?? []).map((r) => (
            <li key={r._id} className="flex items-center gap-3 py-2.5">
              <Badge tone="purple">{r.agentKey}</Badge>
              <span className="min-w-0 flex-1 truncate text-ink-soft">{r.nextAction?.type ?? '—'}</span>
              <Badge tone={r.status === 'done' ? 'green' : 'yellow'}>{r.status}</Badge>
              <span className="text-xs text-ink-soft">{timeAgo(r.createdAt)}</span>
            </li>
          ))}
          {(runs.data?.items.length ?? 0) === 0 && <p className="py-4 text-ink-soft">—</p>}
        </ul>
      </Card>
    </div>
  );
}
