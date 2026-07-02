import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { computeTotals, formatMoney, type InvoiceInput, type InvoiceStatus, type QuoteTotals } from '@truecode/shared';
import { CheckCircle2, DollarSign, FileText, Link2, Loader2, Plus, Receipt, Send, Trash2, Wallet, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { downloadInvoicePdf } from '../lib/invoicePdf';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/auth';

interface LineRow { description: string; category?: string; quantity: number; unitPrice: number }
interface InvoiceDoc {
  _id: string; number: string; title: string; client: { name: string; email?: string; phone?: string; address?: string };
  propertyAddress?: string; lineItems: LineRow[]; currency: string; taxRatePct: number; totals: QuoteTotals;
  amountPaid: number; balance: number; dueDate?: string; status: InvoiceStatus; notes?: string; createdAt: string;
  payments: { amount: number; method: string; ts: string }[]; publicToken?: string;
}
interface Stats { total: number; byStatus: Record<string, number>; outstanding: number; collected: number; }

const STATUS_TONE: Record<InvoiceStatus, 'neutral' | 'blue' | 'green' | 'yellow' | 'pink'> = {
  draft: 'neutral', sent: 'blue', paid: 'green', partial: 'yellow', overdue: 'pink', void: 'neutral',
};

export default function Invoicing() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const account = useAuthStore((s) => s.account);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; title: string; clientName: string; clientEmail: string; propertyAddress: string; currency: InvoiceInput['currency']; taxRatePct: string; dueDays: string; notes: string; lineItems: LineRow[] }>({ open: false, title: '', clientName: '', clientEmail: '', propertyAddress: '', currency: 'USD', taxRatePct: '0', dueDays: '14', notes: '', lineItems: [{ description: '', category: 'Services', quantity: 1, unitPrice: 0 }] });
  const [payAmt, setPayAmt] = useState('');

  const list = useQuery({ queryKey: ['invoices'], queryFn: () => api<{ items: InvoiceDoc[] }>('/invoicing') });
  const stats = useQuery({ queryKey: ['invoices', 'stats'], queryFn: () => api<Stats>('/invoicing/stats') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['invoices'] }); };
  const selected = list.data?.items.find((i) => i._id === selectedId) ?? null;

  const create = useMutation({
    mutationFn: () => api<{ invoice: InvoiceDoc }>('/invoicing', { method: 'POST', body: {
      title: form.title.trim(), client: { name: form.clientName.trim(), email: form.clientEmail.trim() || undefined },
      propertyAddress: form.propertyAddress.trim() || undefined, currency: form.currency, taxRatePct: Number(form.taxRatePct) || 0,
      dueDays: Number(form.dueDays) || 14, notes: form.notes.trim() || undefined,
      lineItems: form.lineItems.filter((r) => r.description.trim()).map((r) => ({ description: r.description.trim(), category: r.category, quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0 })),
    } }),
    onSuccess: (r) => { setForm((f) => ({ ...f, open: false })); setSelectedId(r.invoice._id); refresh(); },
  });
  const act = useMutation({
    mutationFn: (a: { id: string; kind: 'send' | 'delete' | 'share' }) =>
      a.kind === 'delete' ? api(`/invoicing/${a.id}`, { method: 'DELETE' })
      : a.kind === 'share' ? api<{ token: string }>(`/invoicing/${a.id}/share`, { method: 'POST' })
      : api(`/invoicing/${a.id}/send`, { method: 'POST' }),
    onSuccess: (res, a) => { if (a.kind === 'delete' && selectedId === a.id) setSelectedId(null); if (a.kind === 'share') { const tok = (res as { token: string }).token; void navigator.clipboard?.writeText(`${location.origin}/portal/invoice/${tok}`); } refresh(); },
  });
  const pay = useMutation({
    mutationFn: (id: string) => api(`/invoicing/${id}/pay`, { method: 'POST', body: { amount: Number(payAmt) || 0, method: 'other' } }),
    onSuccess: () => { setPayAmt(''); refresh(); },
  });

  if (list.isLoading) return <PageSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  const items = list.data!.items;
  const s = stats.data;
  const liveTotals = computeTotals(form.lineItems, { taxRatePct: Number(form.taxRatePct) || 0 });
  const inp = 'h-11 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';

  const updateRow = (i: number, patch: Partial<LineRow>) => setForm((f) => ({ ...f, lineItems: f.lineItems.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  return (
    <div className="space-y-6">
      <PageHeader title={t('invoicing.title')} subtitle={t('invoicing.subtitle')}
        action={<Button onClick={() => { setForm((f) => ({ ...f, open: !f.open })); setSelectedId(null); }}>{form.open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {t('invoicing.newInvoice')}</Button>} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Receipt} tone="blue" value={s?.total ?? 0} label={t('invoicing.totalInvoices')} />
        <StatCard icon={Wallet} tone="yellow" value={formatMoney(s?.outstanding ?? 0).replace(/\.00$/, '')} label={t('invoicing.outstanding')} />
        <StatCard icon={CheckCircle2} tone="green" value={formatMoney(s?.collected ?? 0).replace(/\.00$/, '')} label={t('invoicing.collected')} />
        <StatCard icon={DollarSign} tone="purple" value={s?.byStatus.paid ?? 0} label={t('invoicing.paidCount')} />
      </div>

      {form.open && (
        <Card className="cf-step-in space-y-4">
          <CardTitle>{t('invoicing.newInvoice')}</CardTitle>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input className={`col-span-2 ${inp}`} placeholder={t('invoicing.invoiceTitle')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className={inp} placeholder={t('invoicing.client')} value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
            <input className={inp} placeholder={t('invoicing.clientEmail')} value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} />
            <input className={`col-span-2 ${inp}`} placeholder={t('invoicing.property')} value={form.propertyAddress} onChange={(e) => setForm({ ...form, propertyAddress: e.target.value })} />
            <select className={inp} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value as InvoiceInput['currency'] })}>{['USD', 'EUR', 'GBP', 'AED', 'SAR', 'BRL', 'MXN'].map((c) => <option key={c}>{c}</option>)}</select>
            <input className={inp} type="number" placeholder={t('invoicing.tax')} value={form.taxRatePct} onChange={(e) => setForm({ ...form, taxRatePct: e.target.value })} />
          </div>
          <div className="space-y-2">
            {form.lineItems.map((r, i) => (
              <div key={i} className="grid grid-cols-12 gap-2">
                <input className={`col-span-6 ${inp}`} placeholder={t('invoicing.itemDesc')} value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} />
                <input className={`col-span-2 ${inp} text-right`} type="number" value={r.quantity} onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })} />
                <input className={`col-span-3 ${inp} text-right`} type="number" value={r.unitPrice} onChange={(e) => updateRow(i, { unitPrice: Number(e.target.value) })} />
                <button className="col-span-1 text-ink-soft hover:text-rose-500" onClick={() => setForm((f) => ({ ...f, lineItems: f.lineItems.filter((_, j) => j !== i) }))}><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, lineItems: [...f.lineItems, { description: '', category: 'Services', quantity: 1, unitPrice: 0 }] }))}><Plus className="h-4 w-4" /> {t('invoicing.addItem')}</Button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-ink-soft">{t('invoicing.total')}: <span className="text-lg font-bold text-ink">{formatMoney(liveTotals.total, form.currency)}</span></span>
            <Button onClick={() => form.title && form.clientName && create.mutate()} disabled={create.isPending || !form.title || !form.clientName}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('invoicing.create')}
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('invoicing.allInvoices')} ({items.length})</p>
          {items.length === 0 && !form.open && <EmptyState icon={Receipt} title={t('invoicing.emptyTitle')} hint={t('invoicing.emptyHint')} action={<Button onClick={() => setForm((f) => ({ ...f, open: true }))}><Plus className="h-4 w-4" /> {t('invoicing.newInvoice')}</Button>} />}
          {items.map((iv) => (
            <button key={iv._id} onClick={() => setSelectedId(iv._id)} className={cn('w-full rounded-card bg-surface p-4 text-left shadow-soft transition-all hover:brightness-[0.98]', selectedId === iv._id && 'ring-2 ring-accent')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{iv.title}</p><p className="text-xs text-ink-soft">{iv.number} · {iv.client.name}</p></div>
                <div className="text-right"><p className="font-semibold tabular-nums">{formatMoney(iv.totals.total, iv.currency).replace(/\.00$/, '')}</p><Badge tone={STATUS_TONE[iv.status]} className="mt-1 capitalize">{t(`invoicing.status.${iv.status}`)}</Badge></div>
              </div>
              {iv.balance > 0 && iv.amountPaid > 0 && <p className="mt-1 text-[11px] text-ink-soft">{t('invoicing.balance')}: {formatMoney(iv.balance, iv.currency)}</p>}
            </button>
          ))}
        </div>

        <div>
          {!selected && !form.open && <EmptyState icon={FileText} title={t('invoicing.selectTitle')} hint={t('invoicing.selectHint')} />}
          {selected && (
            <Card className="cf-step-in space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-xl font-semibold">{selected.title}</h2><p className="text-sm text-ink-soft">{selected.number} · {selected.client.name}</p></div>
                <Badge tone={STATUS_TONE[selected.status]} className="capitalize">{t(`invoicing.status.${selected.status}`)}</Badge>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-ink-soft"><th className="pb-2">{t('invoicing.itemDesc')}</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Unit</th><th className="pb-2 text-right">Amount</th></tr></thead>
                <tbody className="divide-y divide-black/5">{selected.lineItems.map((li, i) => (<tr key={i}><td className="py-2">{li.description}</td><td className="py-2 text-right tabular-nums">{li.quantity}</td><td className="py-2 text-right tabular-nums">{formatMoney(li.unitPrice, selected.currency)}</td><td className="py-2 text-right font-medium tabular-nums">{formatMoney(li.quantity * li.unitPrice, selected.currency)}</td></tr>))}</tbody>
              </table>
              <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-ink-soft">{t('invoicing.subtotal')}</span><span className="tabular-nums">{formatMoney(selected.totals.subtotal, selected.currency)}</span></div>
                {selected.totals.taxAmount > 0 && <div className="flex justify-between"><span className="text-ink-soft">{t('invoicing.tax')}</span><span className="tabular-nums">{formatMoney(selected.totals.taxAmount, selected.currency)}</span></div>}
                <div className="flex justify-between border-t border-black/10 pt-1 text-lg font-bold"><span>{t('invoicing.total')}</span><span className="tabular-nums">{formatMoney(selected.totals.total, selected.currency)}</span></div>
                {selected.amountPaid > 0 && <div className="flex justify-between text-emerald-600"><span>{t('invoicing.paid')}</span><span className="tabular-nums">− {formatMoney(selected.amountPaid, selected.currency)}</span></div>}
                {selected.balance > 0 && <div className="flex justify-between font-semibold"><span>{t('invoicing.balance')}</span><span className="tabular-nums">{formatMoney(selected.balance, selected.currency)}</span></div>}
              </div>

              {selected.status !== 'paid' && selected.status !== 'draft' && (
                <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-3">
                  <input className={`${inp} max-w-[160px]`} type="number" placeholder={t('invoicing.paymentAmt')} value={payAmt} onChange={(e) => setPayAmt(e.target.value)} />
                  <Button size="sm" variant="pastel" onClick={() => Number(payAmt) > 0 && pay.mutate(selected._id)} disabled={pay.isPending}><DollarSign className="h-4 w-4" /> {t('invoicing.recordPayment')}</Button>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-black/5 pt-4">
                <Button size="sm" onClick={() => downloadInvoicePdf(selected, { name: account?.name ?? 'CloseFlow', owner: account?.ownerName, email: account?.email })}><FileText className="h-4 w-4" /> {t('invoicing.pdf')}</Button>
                {selected.status === 'draft' && <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: selected._id, kind: 'send' })}><Send className="h-4 w-4" /> {t('invoicing.send')}</Button>}
                <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: selected._id, kind: 'share' })}><Link2 className="h-4 w-4" /> {t('invoicing.copyLink')}</Button>
                <Button size="sm" variant="ghost" className="ml-auto text-rose-500" onClick={() => act.mutate({ id: selected._id, kind: 'delete' })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
