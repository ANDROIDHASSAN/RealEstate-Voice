import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, Bot, Play, Radio } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { CREW_AGENTS } from '@closeflow/shared';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { useAgentEvents, type AgentEvent } from '../lib/agent-events';
import { api } from '../lib/api';
import { cn, timeAgo } from '../lib/utils';

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

/** An agent counts as "working" when it produced an event in the last 45s. */
const WORKING_WINDOW_MS = 45_000;

const PIE_COLORS = ['#d2ecdb', '#d9e7f7', '#e6ddf8', '#fcebcb', '#f9dcdc'];

function AgentAvatar({ agentKey, working }: { agentKey: string; working: boolean }) {
  const letter = agentKey.charAt(0).toUpperCase();
  return (
    <span
      className={cn(
        'relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-card-purple text-sm font-bold',
        working && 'cf-working bg-card-green',
      )}
    >
      {working ? (
        <span className="flex h-4 items-end gap-[3px] text-ink">
          <span className="cf-wave-bar h-2" />
          <span className="cf-wave-bar h-4" style={{ animationDelay: '150ms' }} />
          <span className="cf-wave-bar h-3" style={{ animationDelay: '300ms' }} />
        </span>
      ) : (
        letter
      )}
    </span>
  );
}

function FeedRow({ event }: { event: AgentEvent }) {
  const tone =
    event.status === 'error' ? 'pink' : event.status === 'blocked' ? 'yellow' : event.status === 'running' ? 'blue' : 'green';
  return (
    <li className="cf-step-in flex items-start gap-3 py-2.5">
      <Badge tone={tone} className="mt-0.5 shrink-0">{event.agentKey}</Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{event.title}</p>
        {event.detail && <p className="truncate text-xs text-ink-soft">{event.detail}</p>}
      </div>
      <span className="shrink-0 text-xs text-ink-soft">{timeAgo(event.ts)}</span>
    </li>
  );
}

export default function Agents() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [leadId, setLeadId] = useState('');
  const [goal, setGoal] = useState('Book a qualified appointment');
  const [lastResult, setLastResult] = useState<{ action?: { type: string; reasoning: string; agentPath: string[] }; source?: string } | null>(null);

  const { events, live } = useAgentEvents();

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

  // Which agents are currently "working" (recent event within the window)?
  const workingAgents = useMemo(() => {
    const now = Date.now();
    const set = new Set<string>();
    for (const e of events) {
      if (now - new Date(e.ts).getTime() < WORKING_WINDOW_MS) set.add(e.agentKey);
    }
    return set;
  }, [events]);

  const actionMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of runs.data?.items ?? []) {
      const key = r.nextAction?.type ?? 'other';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([name, value]) => ({ name, value }));
  }, [runs.data]);

  if (leads.isLoading) return <PageSkeleton />;
  if (leads.isError) return <ErrorState onRetry={() => void leads.refetch()} />;

  const workingCount = CREW_AGENTS.filter((a) => workingAgents.has(a.key)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('agents.title')}
        subtitle={t('agents.subtitle')}
        action={
          <Badge tone={live ? 'green' : 'neutral'}>
            <span className={cn('h-2 w-2 rounded-full', live ? 'cf-live-dot bg-ink' : 'bg-ink-soft')} />
            {live ? t('agents.liveFeed') : t('agents.reconnecting')}
          </Badge>
        }
      />

      {/* The team — animated grid; working agents pulse with equalizer bars */}
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <CardTitle>{t('agents.team')}</CardTitle>
            <CardDescription>
              {workingCount > 0 ? t('agents.workingNow', { count: workingCount }) : t('agents.standingBy')}
            </CardDescription>
          </div>
          <Badge tone="purple">
            <Bot className="h-3 w-3" /> {CREW_AGENTS.length}
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CREW_AGENTS.map((a) => {
            const working = workingAgents.has(a.key);
            return (
              <div
                key={a.key}
                className={cn(
                  'flex items-center gap-3 rounded-2xl p-3 transition-colors',
                  working ? 'bg-card-green' : 'bg-surface-2',
                )}
                title={a.goal}
              >
                <AgentAvatar agentKey={a.key} working={working} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{a.name}</p>
                  <p className="truncate text-xs text-ink-soft">{a.role}</p>
                </div>
                <Badge tone={working ? 'ink' : a.status === 'live' ? 'green' : 'neutral'}>
                  {working ? t('agents.working') : a.status}
                </Badge>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Live activity feed */}
        <Card className="max-h-[460px] overflow-y-auto lg:col-span-3">
          <div className="mb-2 flex items-center gap-2">
            <Radio className="h-5 w-5" />
            <CardTitle>{t('agents.activity')}</CardTitle>
          </div>
          <CardDescription className="mb-3">{t('agents.activityHint')}</CardDescription>
          {events.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-soft">{t('agents.noActivity')}</p>
          ) : (
            <ul className="divide-y divide-black/5">
              {events.map((e) => (
                <FeedRow key={e.id} event={e} />
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5 lg:col-span-2">
          {/* Ask the team */}
          <Card tone="blue">
            <CardTitle className="mb-4">{t('agents.run')}</CardTitle>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (leadId) run.mutate();
              }}
            >
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
              <Button type="submit" disabled={run.isPending || !leadId}>
                <Play className="h-4 w-4" /> {run.isPending ? '…' : t('agents.run')}
              </Button>
            </form>

            {lastResult?.action && (
              <div className="mt-5 rounded-2xl bg-surface p-4">
                <div className="flex items-center gap-2">
                  <Badge tone="ink">{t('agents.action')}: {lastResult.action.type}</Badge>
                  <Badge tone={lastResult.source === 'crewai' ? 'green' : 'yellow'}>
                    {lastResult.source === 'crewai' ? 'CrewAI' : 'TS fallback'}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-ink-soft">{lastResult.action.reasoning}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                  {lastResult.action.agentPath.map((a, i) => (
                    <span key={i} className="cf-step-in flex items-center gap-1.5" style={{ animationDelay: `${i * 250}ms` }}>
                      {i > 0 && <span>→</span>}
                      <span className="rounded-pill bg-card-purple px-2.5 py-0.5">{a}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Decision mix */}
          <Card>
            <div className="mb-1 flex items-center gap-2">
              <Activity className="h-5 w-5" />
              <CardTitle>{t('agents.decisionMix')}</CardTitle>
            </div>
            {actionMix.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-soft">—</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={actionMix} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3}>
                    {actionMix.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      </div>

      {/* Durable run history */}
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
