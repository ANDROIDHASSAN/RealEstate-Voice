import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEAL_STAGES, DEAL_STAGE_META, dealCommission, type DealInput, type DealStage } from '@truecode/shared';
import { CircleDollarSign, Loader2, Plus, Target, Trash2, TrendingUp, Trophy, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api } from '../lib/api';

interface DealDoc {
  _id: string; title: string; clientName: string; propertyAddress?: string; side: string;
  stage: DealStage; value: number; commissionPct: number; expectedCloseDate?: string;
  tasks: { title: string; done: boolean }[];
}
interface DealStats { total: number; byStage: Record<DealStage, number>; pipelineValue: number; weightedValue: number; wonCommission: number; }

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const STAGE_TONE: Record<string, 'neutral' | 'blue' | 'purple' | 'yellow' | 'green' | 'pink'> = {
  neutral: 'neutral', blue: 'blue', purple: 'purple', yellow: 'yellow', green: 'green', pink: 'pink',
};

const BLANK: DealInput = { title: '', clientName: '', propertyAddress: '', side: 'buyer', stage: 'lead', value: 0, commissionPct: 3, tasks: [] };

export default function Deals() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [form, setForm] = useState<DealInput | null>(null);

  const deals = useQuery({ queryKey: ['deals'], queryFn: () => api<{ items: DealDoc[] }>('/deals') });
  const stats = useQuery({ queryKey: ['deals', 'stats'], queryFn: () => api<DealStats>('/deals/stats') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['deals'] }); };

  const save = useMutation({
    mutationFn: (body: DealInput) => api('/deals', { method: 'POST', body }),
    onSuccess: () => { setForm(null); refresh(); },
  });
  const move = useMutation({
    mutationFn: (args: { id: string; stage: DealStage }) => api(`/deals/${args.id}/stage`, { method: 'PATCH', body: { stage: args.stage } }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/deals/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  if (deals.isLoading) return <PageSkeleton />;
  if (deals.isError) return <ErrorState onRetry={() => void deals.refetch()} />;
  const items = deals.data!.items;
  const s = stats.data;
  const input = 'h-11 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';

  return (
    <div className="space-y-6">
      <PageHeader title={t('deals.title')} subtitle={t('deals.subtitle')}
        action={<Button onClick={() => setForm(form ? null : BLANK)}>{form ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {t('deals.newDeal')}</Button>} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Target} tone="blue" value={s?.total ?? 0} label={t('deals.activeDeals')} />
        <StatCard icon={CircleDollarSign} tone="yellow" value={money(s?.pipelineValue ?? 0)} label={t('deals.pipelineValue')} />
        <StatCard icon={TrendingUp} tone="purple" value={money(s?.weightedValue ?? 0)} label={t('deals.weightedValue')} />
        <StatCard icon={Trophy} tone="green" value={money(s?.wonCommission ?? 0)} label={t('deals.wonCommission')} />
      </div>

      {form && (
        <Card className="cf-step-in">
          <CardTitle className="mb-4">{t('deals.newDeal')}</CardTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <input className={`col-span-2 ${input}`} placeholder={t('deals.dealTitle')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className={input} placeholder={t('deals.client')} value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
            <input className={input} placeholder={t('deals.property')} value={form.propertyAddress} onChange={(e) => setForm({ ...form, propertyAddress: e.target.value })} />
            <select className={input} value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value as DealInput['side'] })}>
              <option value="buyer">{t('deals.buyer')}</option><option value="seller">{t('deals.seller')}</option><option value="both">{t('deals.both')}</option>
            </select>
            <select className={input} value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as DealStage })}>
              {DEAL_STAGES.map((st) => <option key={st} value={st}>{DEAL_STAGE_META[st].label}</option>)}
            </select>
            <input type="number" className={input} placeholder={t('deals.value')} value={form.value || ''} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
            <input type="number" className={input} placeholder={t('deals.commissionPct')} value={form.commissionPct} onChange={(e) => setForm({ ...form, commissionPct: Number(e.target.value) })} />
          </div>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => form.title && form.clientName && save.mutate(form)} disabled={save.isPending || !form.title || !form.clientName}>
              {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('deals.create')}
            </Button>
          </div>
        </Card>
      )}

      {/* Kanban board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {DEAL_STAGES.map((stage) => {
          const col = items.filter((d) => d.stage === stage);
          const colValue = col.reduce((sum, d) => sum + d.value, 0);
          return (
            <div key={stage} className="w-72 shrink-0">
              <div className="mb-3 flex items-center justify-between px-1">
                <div className="flex items-center gap-2">
                  <Badge tone={STAGE_TONE[DEAL_STAGE_META[stage].tone]}>{DEAL_STAGE_META[stage].label}</Badge>
                  <span className="text-xs text-ink-soft">{col.length}</span>
                </div>
                {colValue > 0 && <span className="text-[11px] font-medium text-ink-soft">{money(colValue)}</span>}
              </div>
              <div className="space-y-3">
                {col.map((d) => (
                  <Card key={d._id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-tight">{d.title}</p>
                      <Trash2 className="h-3.5 w-3.5 shrink-0 cursor-pointer text-ink-soft hover:text-rose-500" onClick={() => remove.mutate(d._id)} />
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">{d.clientName}{d.propertyAddress ? ` · ${d.propertyAddress}` : ''}</p>
                    {d.value > 0 && (
                      <p className="mt-2 text-sm font-semibold">{money(d.value)} <span className="text-[11px] font-normal text-ink-soft">· {money(dealCommission(d.value, d.commissionPct))} {t('deals.comm')}</span></p>
                    )}
                    <select
                      value={d.stage}
                      onChange={(e) => move.mutate({ id: d._id, stage: e.target.value as DealStage })}
                      className="mt-3 h-9 w-full rounded-2xl border border-black/5 bg-surface-2 px-2 text-xs outline-none"
                    >
                      {DEAL_STAGES.map((st) => <option key={st} value={st}>→ {DEAL_STAGE_META[st].label}</option>)}
                    </select>
                  </Card>
                ))}
                {col.length === 0 && <div className="rounded-card border border-dashed border-black/10 py-8 text-center text-xs text-ink-soft">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
