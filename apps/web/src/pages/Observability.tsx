import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Activity, AlertTriangle, Coins, DollarSign, Gauge, RefreshCcw, Timer, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { timeAgo } from '../lib/utils';

interface ObsStats {
  runs: number;
  totalCostUsd: number;
  totalTokens: number;
  errorRate: number;
  latency: { avgMs: number; p50Ms: number; p95Ms: number };
  byKind: Record<string, { count: number; cost: number; tokens: number; avgMs: number }>;
  trend: { day: string; cost: number; runs: number; tokens: number }[];
}
interface TraceRow {
  _id: string;
  kind: string;
  name: string;
  status: 'running' | 'ok' | 'error';
  durationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  replayable?: boolean;
  createdAt: string;
}
interface Span {
  id: string;
  name: string;
  type: string;
  durationMs: number;
  status: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  error?: string;
  meta?: Record<string, unknown>;
}
interface TraceDetail extends TraceRow {
  spans: Span[];
  error?: string;
  input?: unknown;
}

const money = (n: number) => `$${n < 0.01 ? n.toFixed(5) : n.toFixed(4)}`;
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`);

const statusTone = (s: string): 'pink' | 'yellow' | 'green' => (s === 'error' ? 'pink' : s === 'running' ? 'yellow' : 'green');

export default function Observability() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const stats = useQuery({ queryKey: ['obs', 'stats'], queryFn: () => api<ObsStats>('/observability/stats') });
  const traces = useQuery({ queryKey: ['obs', 'traces'], queryFn: () => api<{ items: TraceRow[] }>('/observability/traces?limit=40') });
  const detail = useQuery({
    queryKey: ['obs', 'trace', selected],
    queryFn: () => api<{ trace: TraceDetail }>(`/observability/traces/${selected}`),
    enabled: Boolean(selected),
  });

  const replay = useMutation({
    mutationFn: (id: string) => api<{ traceId: string }>(`/observability/traces/${id}/replay`, { method: 'POST' }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['obs'] });
      if (d.traceId) setSelected(d.traceId);
    },
  });

  if (stats.isLoading) return <PageSkeleton />;
  if (stats.isError) return <ErrorState onRetry={() => void stats.refetch()} />;
  const s = stats.data!;
  const d = detail.data?.trace;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('obs.title')}
        subtitle={t('obs.subtitle')}
        action={
          <Button variant="secondary" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ['obs'] })}>
            <RefreshCcw className="h-4 w-4" /> {t('common.refresh')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Activity} tone="blue" label={t('obs.runs')} value={s.runs} />
        <StatCard icon={DollarSign} tone="green" label={t('obs.totalCost')} value={money(s.totalCostUsd)} />
        <StatCard icon={Timer} tone="purple" label={t('obs.p95')} value={ms(s.latency.p95Ms)} sub={`p50 ${ms(s.latency.p50Ms)}`} />
        <StatCard icon={AlertTriangle} tone={s.errorRate > 10 ? 'pink' : 'yellow'} label={t('obs.errorRate')} value={`${s.errorRate}%`} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Cost trend */}
        <Card className="lg:col-span-2">
          <CardTitle className="mb-1">{t('obs.costTrend')}</CardTitle>
          <CardDescription className="mb-4">{t('obs.costTrendHint')}</CardDescription>
          {s.trend.length === 0 ? (
            <p className="py-10 text-center text-sm text-ink-soft">{t('obs.noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={s.trend} margin={{ left: -18, right: 8, top: 6 }}>
                <CartesianGrid stroke="#00000010" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B6B6B' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6B6B6B' }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }}
                  formatter={(v: number, n: string) => (n === 'cost' ? money(v) : v)}
                />
                <Bar dataKey="cost" name="cost" fill="#8A6BE0" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* By kind */}
        <Card>
          <CardTitle className="mb-1">{t('obs.byKind')}</CardTitle>
          <CardDescription className="mb-4">{t('obs.tokens', { n: s.totalTokens.toLocaleString() })}</CardDescription>
          <div className="space-y-2">
            {Object.entries(s.byKind)
              .sort((a, b) => b[1].cost - a[1].cost)
              .map(([kind, b]) => (
                <div key={kind} className="flex items-center justify-between rounded-2xl bg-surface/70 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-ink-soft" /> {kind}
                  </span>
                  <span className="tabular-nums text-ink-soft">
                    {b.count} · {money(b.cost)} · {ms(b.avgMs)}
                  </span>
                </div>
              ))}
            {Object.keys(s.byKind).length === 0 && <p className="py-6 text-center text-sm text-ink-soft">{t('obs.noData')}</p>}
          </div>
        </Card>
      </div>

      {/* Traces + detail */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle className="mb-4">{t('obs.recentTraces')}</CardTitle>
          {traces.data?.items.length ? (
            <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {traces.data.items.map((tr) => (
                <button
                  key={tr._id}
                  onClick={() => setSelected(tr._id)}
                  className={`w-full rounded-2xl p-3 text-left transition-colors ${selected === tr._id ? 'bg-card-blue' : 'bg-surface/70 hover:bg-surface-2'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{tr.name}</span>
                    <Badge tone={statusTone(tr.status)}>{tr.status}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                    <Badge tone="neutral">{tr.kind}</Badge>
                    <span className="flex items-center gap-1"><Timer className="h-3 w-3" /> {ms(tr.durationMs)}</span>
                    <span className="flex items-center gap-1"><Coins className="h-3 w-3" /> {tr.totalTokens}</span>
                    <span className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> {money(tr.totalCostUsd)}</span>
                    <span>{timeAgo(tr.createdAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={Activity} title={t('obs.noTraces')} hint={t('obs.noTracesHint')} />
          )}
        </Card>

        <Card tone={d ? 'surface' : 'surface'}>
          {!selected ? (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center text-center">
              <Gauge className="mb-3 h-8 w-8 text-ink-soft" />
              <p className="text-sm text-ink-soft">{t('obs.selectTrace')}</p>
            </div>
          ) : detail.isLoading ? (
            <p className="py-10 text-center text-sm text-ink-soft">…</p>
          ) : d ? (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="min-w-0 truncate">{d.name}</CardTitle>
                {d.replayable && (
                  <Button size="sm" variant="secondary" onClick={() => replay.mutate(d._id)} disabled={replay.isPending}>
                    <RefreshCcw className="h-4 w-4" /> {t('obs.replay')}
                  </Button>
                )}
              </div>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                <Badge tone="neutral">{d.kind}</Badge>
                <span>{ms(d.durationMs)}</span>
                <span>{d.totalTokens} {t('obs.tokensWord')}</span>
                <span>{money(d.totalCostUsd)}</span>
              </div>
              {replay.isError && <p className="mb-3 rounded-2xl bg-card-pink px-3 py-2 text-sm">{t('obs.replayFailed')}</p>}
              {d.error && <p className="mb-3 rounded-2xl bg-card-pink px-3 py-2 text-sm">{d.error}</p>}
              <div className="space-y-2">
                {d.spans.map((sp) => (
                  <div key={sp.id} className="rounded-2xl bg-surface/70 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 font-medium">
                        <span className={`h-2 w-2 rounded-full ${sp.status === 'error' ? 'bg-card-pink' : 'bg-card-green'}`} />
                        {sp.name}
                      </span>
                      <span className="text-xs tabular-nums text-ink-soft">{ms(sp.durationMs)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
                      <Badge tone="neutral">{sp.type}</Badge>
                      {sp.model && <span>{sp.model}</span>}
                      {(sp.tokensIn || sp.tokensOut) && <span>{(sp.tokensIn ?? 0) + (sp.tokensOut ?? 0)} tok</span>}
                      {sp.costUsd ? <span>{money(sp.costUsd)}</span> : null}
                    </div>
                    {sp.error && <p className="mt-1 text-xs text-ink">{sp.error}</p>}
                    {typeof sp.meta?.text === 'string' && <p className="mt-1 line-clamp-2 text-xs text-ink-soft">{sp.meta.text}</p>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <ErrorState onRetry={() => void detail.refetch()} />
          )}
        </Card>
      </div>
    </div>
  );
}
