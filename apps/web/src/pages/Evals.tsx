import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Activity, CheckCircle2, Gauge, PlayCircle, RefreshCcw, ShieldCheck, Sparkles, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { timeAgo } from '../lib/utils';

interface EvalStats {
  threshold: number;
  production: { scored: number; passed: number; passRate: number; avgScore: number; corrected: number };
  trend: { day: string; avgScore: number; passRate: number; count: number }[];
  suites: Record<'capability' | 'regression', { cases: number; lastRun: RunSummary | null }>;
}
interface RunSummary {
  id: string;
  status: string;
  passed: number;
  failed: number;
  total: number;
  passRate: number;
  avgScore: number;
  createdAt: string;
}
interface ScoreRow {
  _id: string;
  target: string;
  agentKey?: string;
  overall: number;
  pass: boolean;
  verdict?: string;
  judge?: string;
  corrected?: boolean;
  createdAt: string;
}
interface CaseResult {
  caseId: string;
  name: string;
  target: string;
  pass: boolean;
  output: string;
  assertionsPassed: number;
  assertionsTotal: number;
  score: { overall: number; verdict: string };
}
interface RunDetail extends RunSummary {
  suite: string;
  results: CaseResult[];
}

const CHART = { grid: '#00000010', line: '#1A1A1A' };

export default function Evals() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [runningId, setRunningId] = useState<string | null>(null);

  const stats = useQuery({ queryKey: ['evals', 'stats'], queryFn: () => api<EvalStats>('/evals/stats'), refetchInterval: runningId ? 2500 : false });
  const scores = useQuery({ queryKey: ['evals', 'scores'], queryFn: () => api<{ items: ScoreRow[] }>('/evals/scores?suite=production&limit=12') });

  const runDetail = useQuery({
    queryKey: ['evals', 'run', runningId],
    queryFn: () => api<{ run: RunDetail }>(`/evals/runs/${runningId}`),
    enabled: Boolean(runningId),
    refetchInterval: (q) => (q.state.data?.run.status === 'running' ? 1500 : false),
  });

  const runSuite = useMutation({
    mutationFn: (suite: 'capability' | 'regression') => api<{ runId: string }>('/evals/run', { method: 'POST', body: { suite } }),
    onSuccess: (d) => {
      setRunningId(d.runId);
      void qc.invalidateQueries({ queryKey: ['evals', 'stats'] });
    },
  });

  if (stats.isLoading) return <PageSkeleton />;
  if (stats.isError) return <ErrorState onRetry={() => void stats.refetch()} />;
  const s = stats.data!;
  const detail = runDetail.data?.run;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('evals.title')}
        subtitle={t('evals.subtitle')}
        action={
          <Button variant="secondary" size="sm" onClick={() => void stats.refetch()}>
            <RefreshCcw className="h-4 w-4" /> {t('common.refresh')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Gauge} tone="green" label={t('evals.avgScore')} value={s.production.avgScore} sub={`/100`} />
        <StatCard icon={CheckCircle2} tone="blue" label={t('evals.passRate')} value={`${s.production.passRate}%`} sub={`≥${s.threshold}`} />
        <StatCard icon={Activity} tone="purple" label={t('evals.callsScored')} value={s.production.scored} />
        <StatCard icon={Sparkles} tone="yellow" label={t('evals.selfCorrections')} value={s.production.corrected} />
      </div>

      {/* Production score trend */}
      <Card>
        <div className="mb-1 flex items-center justify-between">
          <CardTitle>{t('evals.trendTitle')}</CardTitle>
          <Badge tone="neutral">{t('evals.production')}</Badge>
        </div>
        <CardDescription className="mb-4">{t('evals.trendHint')}</CardDescription>
        {s.trend.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-soft">{t('evals.noScores')}</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={s.trend} margin={{ left: -20, right: 8, top: 6 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B6B6B' }} tickLine={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#6B6B6B' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} />
              <Line type="monotone" dataKey="avgScore" name="avg score" stroke={CHART.line} strokeWidth={2.5} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="passRate" name="pass %" stroke="#8A6BE0" strokeWidth={2} strokeDasharray="4 4" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Two suites: capability vs regression */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SuiteCard
          kind="capability"
          icon={Sparkles}
          tone="purple"
          title={t('evals.capabilityTitle')}
          hint={t('evals.capabilityHint')}
          info={s.suites.capability}
          onRun={() => runSuite.mutate('capability')}
          busy={runSuite.isPending || (runningId != null && detail?.status === 'running' && detail.suite === 'capability')}
        />
        <SuiteCard
          kind="regression"
          icon={ShieldCheck}
          tone="green"
          title={t('evals.regressionTitle')}
          hint={t('evals.regressionHint')}
          info={s.suites.regression}
          onRun={() => runSuite.mutate('regression')}
          busy={runSuite.isPending || (runningId != null && detail?.status === 'running' && detail.suite === 'regression')}
        />
      </div>

      {/* Latest run results */}
      {detail && (
        <Card tone={detail.suite === 'regression' && detail.failed > 0 ? 'pink' : 'surface'}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {t('evals.runResults', { suite: detail.suite })} — {detail.passed}/{detail.total} ({detail.passRate}%)
            </CardTitle>
            {detail.status === 'running' ? (
              <Badge tone="yellow">{t('evals.running')}</Badge>
            ) : detail.suite === 'regression' && detail.failed > 0 ? (
              <Badge tone="pink">{t('evals.regressionBroke')}</Badge>
            ) : (
              <Badge tone="green">{t('evals.allGood')}</Badge>
            )}
          </div>
          <div className="space-y-2">
            {(detail.results ?? []).map((r) => (
              <div key={r.caseId} className="flex items-start gap-3 rounded-2xl bg-surface/70 p-3">
                {r.pass ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-ink" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-ink" />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{r.name}</span>
                    <Badge tone="neutral">{r.target}</Badge>
                    <Badge tone={r.pass ? 'green' : 'pink'}>{r.score.overall}/100</Badge>
                    <span className="text-xs text-ink-soft">
                      {r.assertionsPassed}/{r.assertionsTotal} {t('evals.assertions')}
                    </span>
                  </div>
                  {r.score.verdict && <p className="mt-1 text-sm text-ink-soft">{r.score.verdict}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Recent auto-scored production runs */}
      <Card>
        <CardTitle className="mb-1">{t('evals.recentTitle')}</CardTitle>
        <CardDescription className="mb-4">{t('evals.recentHint')}</CardDescription>
        {scores.data?.items.length ? (
          <div className="space-y-2">
            {scores.data.items.map((r) => (
              <div key={r._id} className="flex items-start gap-3 rounded-2xl bg-surface/70 p-3">
                <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${r.pass ? 'bg-card-green' : 'bg-card-pink'}`}>
                  <span className="text-sm font-semibold tabular-nums">{r.overall}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="neutral">{r.target}</Badge>
                    {r.agentKey && <span className="text-sm font-medium">{r.agentKey}</span>}
                    {r.corrected && <Badge tone="yellow">{t('evals.corrected')}</Badge>}
                    <span className="text-xs text-ink-soft">{timeAgo(r.createdAt)}</span>
                  </div>
                  {r.verdict && <p className="mt-1 line-clamp-2 text-sm text-ink-soft">{r.verdict}</p>}
                </div>
                <span className="shrink-0 text-xs text-ink-soft">{r.judge}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={Activity} title={t('evals.noScores')} hint={t('evals.noScoresHint')} />
        )}
      </Card>
    </div>
  );
}

function SuiteCard({
  icon: Icon,
  tone,
  title,
  hint,
  info,
  onRun,
  busy,
}: {
  kind: 'capability' | 'regression';
  icon: typeof Sparkles;
  tone: 'purple' | 'green';
  title: string;
  hint: string;
  info: { cases: number; lastRun: RunSummary | null };
  onRun: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const last = info.lastRun;
  return (
    <Card tone={tone}>
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface/70">
          <Icon className="h-5 w-5 text-ink" />
        </div>
        <Button size="sm" onClick={onRun} disabled={busy}>
          <PlayCircle className="h-4 w-4" /> {busy ? t('evals.running') : t('evals.runSuite')}
        </Button>
      </div>
      <CardTitle className="mt-4">{title}</CardTitle>
      <p className="mt-1 text-sm text-ink-soft">{hint}</p>
      <div className="mt-4 flex items-center gap-4 text-sm">
        <span className="rounded-pill bg-surface/70 px-3 py-1 font-medium">{t('evals.casesCount', { n: info.cases })}</span>
        {last ? (
          <span className="tabular-nums text-ink-soft">
            {t('evals.lastRun')}: {last.passed}/{last.total} ({last.passRate}%) · {timeAgo(last.createdAt)}
          </span>
        ) : (
          <span className="text-ink-soft">{t('evals.neverRun')}</span>
        )}
      </div>
    </Card>
  );
}
