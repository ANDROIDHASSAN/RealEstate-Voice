import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  commissionBreakdown, DEFAULT_QUOTE_SETTINGS, formatMoney, QUOTE_STATUSES,
  type QuoteDTO, type QuoteSettings, type QuoteStatus, type QuoteTemplate,
} from '@truecode/shared';
import {
  CheckCircle2, Copy, FileText, LayoutTemplate, Link2, Percent, Plus, Search, Send, Trash2, Wallet, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { QuoteBuilder } from '../components/quotations/QuoteBuilder';
import { TemplateManager } from '../components/quotations/TemplateManager';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { downloadQuotePdf } from '../lib/quotePdf';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/auth';

interface StatsData {
  total: number;
  byStatus: Record<QuoteStatus, number>;
  pipelineValue: number;
  acceptedValue: number;
  acceptanceRate: number;
}

const STATUS_TONE: Record<QuoteStatus, 'neutral' | 'blue' | 'purple' | 'green' | 'pink' | 'yellow'> = {
  draft: 'neutral', sent: 'blue', viewed: 'purple', accepted: 'green', declined: 'pink', expired: 'yellow',
};
const STATUS_COLOR: Record<QuoteStatus, string> = {
  draft: '#6B6B6B', sent: '#3E8BD1', viewed: '#8A6BE0', accepted: '#1F9D6B', declined: '#E06B6B', expired: '#E0A500',
};

function CommissionCalculator() {
  const { t } = useTranslation();
  const [salePrice, setSalePrice] = useState('525000');
  const [pct, setPct] = useState('3');
  const [split, setSplit] = useState('70');
  const [fee, setFee] = useState('395');
  const b = commissionBreakdown({ salePrice: Number(salePrice) || 0, commissionPct: Number(pct) || 0, agentSplitPct: Number(split) || 0, transactionFee: Number(fee) || 0 });
  const input = 'h-10 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';
  return (
    <Card tone="green">
      <CardTitle className="mb-3 flex items-center gap-2"><Percent className="h-4 w-4" /> {t('quotations.commissionCalc')}</CardTitle>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-ink-soft">{t('quotations.salePrice')}<input className={`mt-1 ${input}`} type="number" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></label>
        <label className="text-xs text-ink-soft">{t('quotations.commissionPct')}<input className={`mt-1 ${input}`} type="number" value={pct} onChange={(e) => setPct(e.target.value)} /></label>
        <label className="text-xs text-ink-soft">{t('quotations.agentSplit')}<input className={`mt-1 ${input}`} type="number" value={split} onChange={(e) => setSplit(e.target.value)} /></label>
        <label className="text-xs text-ink-soft">{t('quotations.txFee')}<input className={`mt-1 ${input}`} type="number" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
      </div>
      <div className="mt-3 space-y-1 rounded-2xl bg-surface/70 p-3 text-sm">
        <div className="flex justify-between"><span className="text-ink-soft">{t('quotations.grossCommission')}</span><span className="font-medium tabular-nums">{formatMoney(b.grossCommission)}</span></div>
        <div className="flex justify-between"><span className="text-ink-soft">{t('quotations.brokerageCut')}</span><span className="tabular-nums">{formatMoney(b.brokerageGross)}</span></div>
        <div className="flex justify-between border-t border-black/10 pt-1 text-base font-bold"><span>{t('quotations.agentNet')}</span><span className="tabular-nums text-emerald-600">{formatMoney(b.agentNet)}</span></div>
      </div>
    </Card>
  );
}

/** Preview line items grouped by category (proposal "sections"). */
function QuotePreview({ quote }: { quote: QuoteDTO }) {
  const { t } = useTranslation();
  const cur = quote.currency;
  const included = quote.lineItems.filter((li) => !li.optional);
  const optional = quote.lineItems.filter((li) => li.optional);
  const groups = useMemo(() => {
    const map = new Map<string, typeof included>();
    for (const li of included) {
      const k = li.category || t('quotations.uncategorized');
      (map.get(k) ?? map.set(k, []).get(k)!).push(li);
    }
    return Array.from(map.entries());
  }, [included, t]);
  const money = (n: number) => formatMoney(n, cur);
  const net = (li: QuoteDTO['lineItems'][number]) => {
    const gross = li.quantity * li.unitPrice;
    return gross - (li.discountPct ? (gross * li.discountPct) / 100 : 0);
  };

  return (
    <div className="space-y-4">
      {groups.map(([cat, items]) => (
        <div key={cat}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft" style={{ color: quote.accentColor }}>{cat}</p>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-black/5">
              {items.map((li, i) => (
                <tr key={i}>
                  <td className="py-2 pr-2">{li.description}{li.discountPct ? <span className="ml-1 text-[10px] text-rose-500">−{li.discountPct}%</span> : null}{li.taxable === false && <span className="ml-1 text-[10px] text-ink-soft">({t('quotations.noTax')})</span>}</td>
                  <td className="py-2 text-right tabular-nums text-ink-soft">{li.quantity}{li.unit ? ` ${li.unit}` : ''}</td>
                  <td className="py-2 text-right tabular-nums text-ink-soft">{money(li.unitPrice)}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{money(net(li))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {optional.length > 0 && (
        <div className="rounded-2xl border border-dashed border-black/10 p-3">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{t('quotations.optionalAddOns')}</p>
          {optional.map((li, i) => (
            <div key={i} className="flex justify-between py-1 text-sm">
              <span className="text-ink-soft">{li.description}</span>
              <span className="tabular-nums">+ {money(net(li))}</span>
            </div>
          ))}
        </div>
      )}

      <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
        <div className="flex justify-between"><span className="text-ink-soft">{t('quotations.subtotal')}</span><span className="tabular-nums">{money(quote.totals.subtotal)}</span></div>
        {quote.totals.discountAmount > 0 && <div className="flex justify-between"><span className="text-ink-soft">{t('quotations.discount')}</span><span className="tabular-nums text-rose-500">− {money(quote.totals.discountAmount)}</span></div>}
        {quote.totals.taxAmount > 0 && <div className="flex justify-between"><span className="text-ink-soft">{quote.taxLabel || t('quotations.tax')} ({quote.taxRatePct}%)</span><span className="tabular-nums">{money(quote.totals.taxAmount)}</span></div>}
        <div className="flex justify-between border-t border-black/10 pt-1 text-lg font-bold"><span>{t('quotations.total')}</span><span className="tabular-nums" style={{ color: quote.accentColor }}>{money(quote.totals.total)}</span></div>
        {quote.totals.depositAmount > 0 && (
          <>
            <div className="flex justify-between pt-1"><span className="text-ink-soft">{t('quotations.depositDue')}</span><span className="font-medium tabular-nums text-emerald-600">{money(quote.totals.depositAmount)}</span></div>
            <div className="flex justify-between"><span className="text-ink-soft">{t('quotations.balanceDue')}</span><span className="tabular-nums">{money(quote.totals.balanceDue)}</span></div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Quotations() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const account = useAuthStore((s) => s.account);
  const [builder, setBuilder] = useState<'closed' | 'new' | QuoteDTO>('closed');
  const [showTemplates, setShowTemplates] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const list = useQuery({ queryKey: ['quotes'], queryFn: () => api<{ items: QuoteDTO[] }>('/quotations') });
  const stats = useQuery({ queryKey: ['quotes', 'stats'], queryFn: () => api<StatsData>('/quotations/stats') });
  const templates = useQuery({ queryKey: ['quote-templates'], queryFn: () => api<{ templates: QuoteTemplate[]; custom: QuoteTemplate[] }>('/quotations/templates') });
  const settings = useQuery({ queryKey: ['quote-settings'], queryFn: () => api<{ settings: QuoteSettings }>('/quotations/settings') });

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['quotes'] }); };
  const refreshTemplates = () => { void qc.invalidateQueries({ queryKey: ['quote-templates'] }); void qc.invalidateQueries({ queryKey: ['quote-settings'] }); };

  const mutate = useMutation({
    mutationFn: (args: { id: string; action: 'send' | 'duplicate' | 'delete' | 'share'; }) => {
      if (args.action === 'delete') return api(`/quotations/${args.id}`, { method: 'DELETE' });
      if (args.action === 'send') return api(`/quotations/${args.id}/send`, { method: 'POST' });
      if (args.action === 'share') return api<{ token: string }>(`/quotations/${args.id}/share`, { method: 'POST' });
      return api(`/quotations/${args.id}/duplicate`, { method: 'POST' });
    },
    onSuccess: async (res, args) => {
      if (args.action === 'delete' && selectedId === args.id) setSelectedId(null);
      if (args.action === 'share' && res && typeof res === 'object' && 'token' in res) {
        const url = `${window.location.origin}/portal/quote/${(res as { token: string }).token}`;
        try { await navigator.clipboard.writeText(url); setCopiedLink(true); setTimeout(() => setCopiedLink(false), 2500); } catch { /* clipboard blocked */ }
      }
      refresh();
    },
  });
  const setStatus = useMutation({
    mutationFn: (args: { id: string; status: Exclude<QuoteStatus, 'draft' | 'sent'> }) => api(`/quotations/${args.id}/status`, { method: 'PATCH', body: { status: args.status } }),
    onSuccess: refresh,
  });

  const selected = useMemo(() => list.data?.items.find((q) => q._id === selectedId) ?? null, [list.data, selectedId]);
  const allTemplates = useMemo(() => [...(templates.data?.templates ?? []), ...(templates.data?.custom ?? [])], [templates.data]);
  const settingsData = settings.data?.settings ?? DEFAULT_QUOTE_SETTINGS;

  if (list.isLoading) return <PageSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  const q = search.trim().toLowerCase();
  const items = list.data!.items.filter((it) => !q || it.title.toLowerCase().includes(q) || it.number.toLowerCase().includes(q) || it.client.name.toLowerCase().includes(q));
  const s = stats.data;
  const donut = s ? QUOTE_STATUSES.map((st) => ({ name: st, value: s.byStatus[st] })).filter((d) => d.value > 0) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('quotations.title2')}
        subtitle={t('quotations.subtitle')}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => { setShowTemplates((v) => !v); setBuilder('closed'); }}><LayoutTemplate className="h-4 w-4" /> {t('quotations.templates')}</Button>
            <Button onClick={() => { setBuilder('new'); setShowTemplates(false); setSelectedId(null); }}><Plus className="h-4 w-4" /> {t('quotations.newQuote')}</Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FileText} tone="blue" value={s?.total ?? 0} label={t('quotations.totalQuotes')} />
        <StatCard icon={Wallet} tone="yellow" value={formatMoney(s?.pipelineValue ?? 0).replace(/\.00$/, '')} label={t('quotations.pipelineValue')} />
        <StatCard icon={CheckCircle2} tone="green" value={formatMoney(s?.acceptedValue ?? 0).replace(/\.00$/, '')} label={t('quotations.acceptedValue')} />
        <StatCard icon={Percent} tone="purple" value={`${s?.acceptanceRate ?? 0}%`} label={t('quotations.acceptanceRate')} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card>
          <CardTitle className="mb-4">{t('quotations.byStatus')}</CardTitle>
          {donut.length === 0 ? (
            <p className="py-14 text-center text-sm text-ink-soft">{t('quotations.noQuotes')}</p>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={donut} dataKey="value" nameKey="name" innerRadius={42} outerRadius={66} paddingAngle={3} strokeWidth={0}>
                    {donut.map((d) => <Cell key={d.name} fill={STATUS_COLOR[d.name as QuoteStatus]} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="space-y-1.5 text-sm">
                {donut.map((d) => (
                  <li key={d.name} className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: STATUS_COLOR[d.name as QuoteStatus] }} />
                    <span className="capitalize text-ink-soft">{t(`quotations.status.${d.name}`)}</span>
                    <span className="font-semibold">{d.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <div className="lg:col-span-2"><CommissionCalculator /></div>
      </div>

      {showTemplates && (
        <TemplateManager
          customTemplates={templates.data?.custom ?? []}
          settings={settingsData}
          onChanged={refreshTemplates}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {builder !== 'closed' && (
        <QuoteBuilder
          initial={builder === 'new' ? null : builder}
          templates={allTemplates}
          categories={settingsData.categories}
          defaults={settingsData}
          onSaved={(saved) => { setBuilder('closed'); setSelectedId(saved._id); refresh(); }}
          onCancel={() => setBuilder('closed')}
          onTemplatesChanged={refreshTemplates}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('quotations.allQuotes')} ({items.length})</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-soft" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('quotations.searchPlaceholder')}
                className="h-9 w-44 rounded-pill border border-black/5 bg-surface pl-8 pr-3 text-sm outline-none focus:ring-2 focus:ring-ink/10" />
            </div>
          </div>
          {items.length === 0 && builder === 'closed' && (
            <EmptyState icon={FileText} title={t('quotations.emptyTitle')} hint={t('quotations.emptyHint')} action={<Button onClick={() => setBuilder('new')}><Plus className="h-4 w-4" /> {t('quotations.newQuote')}</Button>} />
          )}
          {items.map((it) => (
            <button key={it._id} onClick={() => { setSelectedId(it._id); setBuilder('closed'); setShowTemplates(false); }}
              className={cn('w-full rounded-card bg-surface p-4 text-left shadow-soft transition-all hover:brightness-[0.98]', selectedId === it._id && 'ring-2 ring-accent')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{it.title}</p>
                  <p className="text-xs text-ink-soft">{it.number} · {it.client.name}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{formatMoney(it.totals.total, it.currency).replace(/\.00$/, '')}</p>
                  <Badge tone={STATUS_TONE[it.status]} className="mt-1 capitalize">{t(`quotations.status.${it.status}`)}</Badge>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Preview */}
        <div>
          {!selected && builder === 'closed' && !showTemplates && (
            <EmptyState icon={FileText} title={t('quotations.selectTitle')} hint={t('quotations.selectHint')} />
          )}
          {selected && (
            <Card className="cf-step-in space-y-4" style={selected.accentColor ? { borderTop: `4px solid ${selected.accentColor}` } : undefined}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{selected.title}</h2>
                  <p className="text-sm text-ink-soft">{selected.number} · {t('quotations.for')} {selected.client.name}{selected.client.company ? ` · ${selected.client.company}` : ''}</p>
                </div>
                <Badge tone={STATUS_TONE[selected.status]} className="capitalize">{t(`quotations.status.${selected.status}`)}</Badge>
              </div>

              {selected.summary && <p className="rounded-2xl bg-surface-2/50 p-3 text-sm text-ink-soft">{selected.summary}</p>}

              <QuotePreview quote={selected} />

              {(selected.notes || selected.terms) && (
                <div className="space-y-1 rounded-2xl bg-surface-2 p-3 text-xs text-ink-soft">
                  {selected.notes && <p><span className="font-semibold text-ink">{t('quotations.notes')}:</span> {selected.notes}</p>}
                  {selected.terms && <p><span className="font-semibold text-ink">{t('quotations.terms')}:</span> {selected.terms}</p>}
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 border-t border-black/5 pt-4">
                <Button size="sm" onClick={() => downloadQuotePdf(selected, { name: account?.name ?? 'CloseFlow', owner: account?.ownerName, email: account?.email })}><FileText className="h-4 w-4" /> {t('quotations.pdf')}</Button>
                {selected.status === 'draft' && <Button size="sm" variant="secondary" onClick={() => mutate.mutate({ id: selected._id, action: 'send' })}><Send className="h-4 w-4" /> {t('quotations.send')}</Button>}
                <Button size="sm" variant="secondary" onClick={() => mutate.mutate({ id: selected._id, action: 'share' })}><Link2 className="h-4 w-4" /> {copiedLink ? t('quotations.linkCopied') : t('quotations.shareLink')}</Button>
                {selected.status !== 'accepted' && <Button size="sm" variant="secondary" onClick={() => { setBuilder(selected); setShowTemplates(false); }}>{t('quotations.edit')}</Button>}
                <Button size="sm" variant="ghost" onClick={() => mutate.mutate({ id: selected._id, action: 'duplicate' })}><Copy className="h-4 w-4" /> {t('quotations.duplicate')}</Button>
                {(selected.status === 'sent' || selected.status === 'viewed') && (
                  <>
                    <Button size="sm" variant="pastel" onClick={() => setStatus.mutate({ id: selected._id, status: 'accepted' })}><CheckCircle2 className="h-4 w-4" /> {t('quotations.markAccepted')}</Button>
                    <Button size="sm" variant="danger" onClick={() => setStatus.mutate({ id: selected._id, status: 'declined' })}><X className="h-4 w-4" /> {t('quotations.markDeclined')}</Button>
                  </>
                )}
                <Button size="sm" variant="ghost" className="ml-auto text-rose-500" onClick={() => mutate.mutate({ id: selected._id, action: 'delete' })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
