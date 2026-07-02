import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type LedgerSummary, type LedgerType } from '@truecode/shared';
import { ArrowDownCircle, ArrowUpCircle, Loader2, Plus, Scale, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api } from '../lib/api';

interface Entry { _id: string; type: LedgerType; category: string; description?: string; amount: number; date: string; }
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function Ledger() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ type: 'income' as LedgerType, category: 'commission', description: '', amount: '', date: todayISO() });

  const list = useQuery({ queryKey: ['ledger'], queryFn: () => api<{ items: Entry[] }>('/ledger') });
  const summary = useQuery({ queryKey: ['ledger', 'summary'], queryFn: () => api<{ summary: LedgerSummary }>('/ledger/summary') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['ledger'] }); };

  const add = useMutation({
    mutationFn: () => api('/ledger', { method: 'POST', body: { type: f.type, category: f.category, description: f.description.trim() || undefined, amount: Number(f.amount), date: f.date } }),
    onSuccess: () => { setF((s) => ({ ...s, description: '', amount: '' })); refresh(); },
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/ledger/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  if (list.isLoading) return <PageSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  const items = list.data!.items;
  const sum = summary.data?.summary;
  const cats = f.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const inp = 'h-11 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';

  return (
    <div className="space-y-6">
      <PageHeader title={t('ledger.title')} subtitle={t('ledger.subtitle')} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <StatCard icon={ArrowUpCircle} tone="green" value={money(sum?.totalIncome ?? 0)} label={t('ledger.income')} />
        <StatCard icon={ArrowDownCircle} tone="pink" value={money(sum?.totalExpense ?? 0)} label={t('ledger.expenses')} />
        <StatCard icon={Scale} tone={sum && sum.net >= 0 ? 'green' : 'yellow'} value={money(sum?.net ?? 0)} label={t('ledger.net')} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle className="mb-4">{t('ledger.monthly')}</CardTitle>
          {!sum || sum.byMonth.length === 0 ? (
            <p className="py-14 text-center text-sm text-ink-soft">{t('ledger.empty')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={sum.byMonth} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EFE8E0" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6B6B6B' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#6B6B6B' }} width={44} />
                <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} formatter={(v: number) => money(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name={t('ledger.income')} fill="#1F9D6B" radius={[6, 6, 0, 0]} />
                <Bar dataKey="expense" name={t('ledger.expenses')} fill="#E06B6B" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Add entry */}
        <Card tone="green">
          <CardTitle className="mb-3">{t('ledger.addEntry')}</CardTitle>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setF({ ...f, type: 'income', category: 'commission' })} className={`h-10 rounded-2xl text-sm font-medium ${f.type === 'income' ? 'bg-accent text-accent-on' : 'bg-surface'}`}>{t('ledger.income')}</button>
              <button onClick={() => setF({ ...f, type: 'expense', category: 'marketing' })} className={`h-10 rounded-2xl text-sm font-medium ${f.type === 'expense' ? 'bg-accent text-accent-on' : 'bg-surface'}`}>{t('ledger.expense')}</button>
            </div>
            <select className={inp} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            <input className={inp} placeholder={t('ledger.description')} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
            <input className={inp} type="number" placeholder={t('ledger.amount')} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            <input className={inp} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            <Button className="w-full" onClick={() => Number(f.amount) > 0 && add.mutate()} disabled={add.isPending || !(Number(f.amount) > 0)}>
              {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('ledger.add')}
            </Button>
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle className="mb-3 flex items-center gap-2"><Wallet className="h-4 w-4" /> {t('ledger.transactions')}</CardTitle>
        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-soft">{t('ledger.empty')}</p>
        ) : (
          <ul className="divide-y divide-black/5">
            {items.map((e) => (
              <li key={e._id} className="flex items-center gap-3 py-3">
                <span className={`flex h-9 w-9 items-center justify-center rounded-full ${e.type === 'income' ? 'bg-card-green' : 'bg-card-pink'}`}>
                  {e.type === 'income' ? <ArrowUpCircle className="h-4 w-4" /> : <ArrowDownCircle className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{e.description || e.category}</p>
                  <p className="text-xs text-ink-soft">{new Date(e.date).toLocaleDateString()} · <Badge tone="neutral">{e.category}</Badge></p>
                </div>
                <span className={`font-semibold tabular-nums ${e.type === 'income' ? 'text-emerald-600' : 'text-rose-500'}`}>{e.type === 'income' ? '+' : '−'} {money(e.amount)}</span>
                <Trash2 className="h-3.5 w-3.5 cursor-pointer text-ink-soft hover:text-rose-500" onClick={() => remove.mutate(e._id)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
