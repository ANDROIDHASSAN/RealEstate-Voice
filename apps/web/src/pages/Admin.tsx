import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, DollarSign, Eye, Loader2, PauseCircle, PlayCircle, Search, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import type { SessionAccount, SessionUser } from '../store/auth';
import { useAuthStore } from '../store/auth';

interface AdminAccount { _id: string; name: string; email: string; plan: string; status: string; enabledModules: string[]; userCount: number; leadCount: number; createdAt: string; }
interface Stats { totalAccounts: number; activeAccounts: number; suspendedAccounts: number; totalUsers: number; totalLeads: number; byPlan: Record<string, number>; estMrr: number; }

const PLAN_TONE: Record<string, 'neutral' | 'blue' | 'purple' | 'green'> = { starter: 'neutral', pro: 'blue', empire: 'purple', ultimate: 'green' };
const STATUS_TONE: Record<string, 'green' | 'yellow' | 'pink' | 'neutral'> = { active: 'green', past_due: 'yellow', suspended: 'pink', canceled: 'neutral' };

export default function Admin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const startImpersonation = useAuthStore((s) => s.startImpersonation);
  const [q, setQ] = useState('');

  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<Stats>('/admin/stats') });
  const accounts = useQuery({ queryKey: ['admin', 'accounts', q], queryFn: () => api<{ accounts: AdminAccount[] }>(`/admin/accounts${q ? `?q=${encodeURIComponent(q)}` : ''}`) });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['admin'] }); };

  const patch = useMutation({
    mutationFn: (a: { id: string; body: Record<string, unknown> }) => api(`/admin/accounts/${a.id}`, { method: 'PATCH', body: a.body }),
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/admin/accounts/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const impersonate = useMutation({
    mutationFn: (id: string) => api<{ accessToken: string; user: SessionUser; account: SessionAccount }>(`/admin/accounts/${id}/impersonate`, { method: 'POST' }),
    onSuccess: (s) => { startImpersonation(s); navigate('/'); },
  });

  if (accounts.isLoading) return <PageSkeleton />;
  if (accounts.isError) return <ErrorState onRetry={() => void accounts.refetch()} />;
  const rows = accounts.data!.accounts;
  const s = stats.data;

  return (
    <div className="space-y-6">
      <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} />

      <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
        <StatCard icon={Building2} tone="blue" value={s?.totalAccounts ?? 0} label={t('admin.tenants')} sub={s ? `${s.activeAccounts} ${t('admin.active')}` : undefined} />
        <StatCard icon={Users} tone="purple" value={s?.totalUsers ?? 0} label={t('admin.users')} />
        <StatCard icon={DollarSign} tone="green" value={`$${(s?.estMrr ?? 0).toLocaleString()}`} label={t('admin.mrr')} />
        <StatCard icon={PauseCircle} tone="pink" value={s?.suspendedAccounts ?? 0} label={t('admin.suspended')} />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t('admin.allTenants')} ({rows.length})</CardTitle>
          <div className="flex items-center gap-2 rounded-pill bg-surface-2 px-3">
            <Search className="h-4 w-4 text-ink-soft" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('admin.search')} className="h-9 bg-transparent text-sm outline-none" />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-ink-soft">
              <th className="pb-2 pr-4">{t('admin.tenant')}</th><th className="pb-2 pr-4">{t('admin.plan')}</th>
              <th className="pb-2 pr-4">{t('admin.status')}</th><th className="pb-2 pr-4">{t('admin.users')}</th>
              <th className="pb-2 pr-4">{t('admin.leads')}</th><th className="pb-2">{t('admin.actions')}</th>
            </tr></thead>
            <tbody className="divide-y divide-black/5">
              {rows.map((a) => (
                <tr key={a._id}>
                  <td className="py-3 pr-4"><p className="font-medium">{a.name}</p><p className="text-xs text-ink-soft">{a.email}</p></td>
                  <td className="py-3 pr-4">
                    <select value={a.plan} onChange={(e) => patch.mutate({ id: a._id, body: { plan: e.target.value } })} className="h-8 rounded-pill border border-black/5 bg-surface-2 px-2 text-xs capitalize outline-none">
                      {['starter', 'pro', 'empire', 'ultimate'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <Badge tone={PLAN_TONE[a.plan]} className="ml-1 hidden">{a.plan}</Badge>
                  </td>
                  <td className="py-3 pr-4"><Badge tone={STATUS_TONE[a.status] ?? 'neutral'} className="capitalize">{a.status}</Badge></td>
                  <td className="py-3 pr-4 tabular-nums">{a.userCount}</td>
                  <td className="py-3 pr-4 tabular-nums">{a.leadCount}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" title={t('admin.impersonate')} onClick={() => impersonate.mutate(a._id)} disabled={impersonate.isPending}>
                        {impersonate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" title={a.status === 'suspended' ? t('admin.reactivate') : t('admin.suspend')} onClick={() => patch.mutate({ id: a._id, body: { status: a.status === 'suspended' ? 'active' : 'suspended' } })}>
                        {a.status === 'suspended' ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-rose-500" title={t('admin.delete')} onClick={() => { if (confirm(t('admin.confirmDelete', { name: a.name }))) del.mutate(a._id); }}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
