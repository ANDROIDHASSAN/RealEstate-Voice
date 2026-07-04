import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, Inbox, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { APPROVAL_ACTION_META, APPROVAL_ACTIONS, type ApprovalAction } from '@truecode/shared';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { timeAgo } from '../lib/utils';
import { userCan, useAuthStore } from '../store/auth';

interface ApprovalRow {
  _id: string;
  action: ApprovalAction;
  title: string;
  summary?: string;
  risk: 'low' | 'medium' | 'high';
  status: string;
  origin?: string;
  reason?: string;
  createdAt: string;
  decidedAt?: string;
  result?: Record<string, unknown>;
}
interface Policy {
  approvalPolicy: Record<string, boolean>;
  selfCorrect: { enabled: boolean; threshold: number; maxAttempts: number };
}

const riskTone = (r: string): 'pink' | 'yellow' | 'blue' => (r === 'high' ? 'pink' : r === 'medium' ? 'yellow' : 'blue');
const statusTone = (s: string): 'green' | 'yellow' | 'pink' | 'neutral' =>
  s === 'executed' ? 'green' : s === 'pending' ? 'yellow' : s === 'rejected' || s === 'failed' ? 'pink' : 'neutral';

export default function Approvals() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const canManage = userCan(user, 'account:manage');

  const list = useQuery({ queryKey: ['approvals', 'list'], queryFn: () => api<{ items: ApprovalRow[] }>('/approvals'), refetchInterval: 5000 });
  const stats = useQuery({ queryKey: ['approvals', 'stats'], queryFn: () => api<{ total: number; pending: number; byStatus: Record<string, number> }>('/approvals/stats') });
  const policy = useQuery({ queryKey: ['approvals', 'policy'], queryFn: () => api<Policy>('/approvals/policy') });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'reject' }) =>
      api(`/approvals/${id}/${decision}`, { method: 'POST', body: {} }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['approvals'] }),
  });

  const savePolicy = useMutation({
    mutationFn: (body: { policy: Record<string, boolean>; selfCorrect?: Policy['selfCorrect'] }) =>
      api<Policy>('/approvals/policy', { method: 'PUT', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['approvals', 'policy'] }),
  });

  if (list.isLoading) return <PageSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;

  const items = list.data!.items;
  const pending = items.filter((a) => a.status === 'pending');
  const history = items.filter((a) => a.status !== 'pending');
  const st = stats.data?.byStatus ?? {};
  const pol = policy.data;

  const toggle = (action: string) => {
    if (!pol) return;
    savePolicy.mutate({ policy: { ...pol.approvalPolicy, [action]: !pol.approvalPolicy[action] } });
  };

  return (
    <div className="space-y-6">
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Clock} tone="yellow" label={t('approvals.pending')} value={stats.data?.pending ?? pending.length} />
        <StatCard icon={Check} tone="green" label={t('approvals.executed')} value={st.executed ?? 0} />
        <StatCard icon={X} tone="pink" label={t('approvals.rejected')} value={st.rejected ?? 0} />
        <StatCard icon={Inbox} tone="blue" label={t('approvals.total')} value={stats.data?.total ?? items.length} />
      </div>

      {/* Pending queue */}
      <Card>
        <CardTitle className="mb-1">{t('approvals.queueTitle')}</CardTitle>
        <CardDescription className="mb-4">{t('approvals.queueHint')}</CardDescription>
        {pending.length ? (
          <div className="space-y-3">
            {pending.map((a) => {
              const meta = APPROVAL_ACTION_META[a.action];
              return (
                <div key={a._id} className="flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-surface/70 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={riskTone(a.risk)}>{t(`approvals.risk.${a.risk}`)}</Badge>
                      <Badge tone="neutral">{meta?.label ?? a.action}</Badge>
                      <span className="font-medium">{a.title}</span>
                    </div>
                    {a.summary && <p className="mt-1 text-sm text-ink-soft">{a.summary}</p>}
                    <p className="mt-1 text-xs text-ink-soft">
                      {a.origin && `${a.origin} · `}
                      {timeAgo(a.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button size="sm" onClick={() => decide.mutate({ id: a._id, decision: 'approve' })} disabled={decide.isPending}>
                      <Check className="h-4 w-4" /> {t('approvals.approve')}
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: a._id, decision: 'reject' })} disabled={decide.isPending}>
                      <X className="h-4 w-4" /> {t('approvals.reject')}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={ShieldAlert} title={t('approvals.emptyTitle')} hint={t('approvals.emptyHint')} />
        )}
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Policy */}
        <Card tone="purple">
          <CardTitle className="mb-1">{t('approvals.policyTitle')}</CardTitle>
          <CardDescription className="mb-4">{t('approvals.policyHint')}</CardDescription>
          <div className="space-y-2">
            {APPROVAL_ACTIONS.map((action) => {
              const meta = APPROVAL_ACTION_META[action];
              const on = pol?.approvalPolicy[action] ?? false;
              return (
                <button
                  key={action}
                  disabled={!canManage || savePolicy.isPending}
                  onClick={() => toggle(action)}
                  className="flex w-full items-center justify-between rounded-2xl bg-surface/70 px-4 py-3 text-left disabled:opacity-60"
                >
                  <span>
                    <span className="font-medium">{meta.label}</span>
                    <span className="block text-xs text-ink-soft">{meta.hint}</span>
                  </span>
                  <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-black/15'}`}>
                    <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${on ? 'left-[22px]' : 'left-0.5'}`} />
                  </span>
                </button>
              );
            })}
          </div>
          {!canManage && <p className="mt-3 text-xs text-ink-soft">{t('approvals.policyLocked')}</p>}
        </Card>

        {/* Self-correction + history */}
        <div className="space-y-5">
          <Card tone="green">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface/70">
                <Sparkles className="h-5 w-5 text-ink" />
              </div>
              <div className="min-w-0">
                <CardTitle>{t('approvals.selfCorrectTitle')}</CardTitle>
                <p className="mt-1 text-sm text-ink-soft">{t('approvals.selfCorrectHint')}</p>
                {pol && (
                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    <Badge tone={pol.selfCorrect.enabled ? 'green' : 'neutral'}>
                      {pol.selfCorrect.enabled ? t('approvals.on') : t('approvals.off')}
                    </Badge>
                    <Badge tone="neutral">{t('approvals.threshold', { n: pol.selfCorrect.threshold })}</Badge>
                    <Badge tone="neutral">{t('approvals.maxAttempts', { n: pol.selfCorrect.maxAttempts })}</Badge>
                  </div>
                )}
                {canManage && pol && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-4"
                    disabled={savePolicy.isPending}
                    onClick={() => savePolicy.mutate({ policy: pol.approvalPolicy, selfCorrect: { ...pol.selfCorrect, enabled: !pol.selfCorrect.enabled } })}
                  >
                    {pol.selfCorrect.enabled ? t('approvals.disable') : t('approvals.enable')}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          <Card>
            <CardTitle className="mb-4">{t('approvals.historyTitle')}</CardTitle>
            {history.length ? (
              <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                {history.map((a) => (
                  <div key={a._id} className="flex items-center justify-between gap-2 rounded-2xl bg-surface/70 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">{a.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={statusTone(a.status)}>{t(`approvals.status.${a.status}`, a.status)}</Badge>
                      <span className="text-xs text-ink-soft">{timeAgo(a.decidedAt ?? a.createdAt)}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-6 text-center text-sm text-ink-soft">{t('approvals.noHistory')}</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
