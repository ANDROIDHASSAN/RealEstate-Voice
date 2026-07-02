import { useMutation } from '@tanstack/react-query';
import { computeTotals, formatMoney, type QuoteDTO, type QuoteInput, type QuoteTemplate } from '@truecode/shared';
import { Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';

interface LineRow { description: string; category?: string; quantity: number; unitPrice: number }

interface FormState {
  title: string; clientName: string; clientEmail: string; clientPhone: string; clientAddress: string;
  propertyAddress: string; currency: QuoteInput['currency']; taxRatePct: string;
  discountType: QuoteInput['discountType']; discountValue: string; notes: string; terms: string;
  validDays: string; templateKey: string; lineItems: LineRow[];
}

const CURRENCIES: QuoteInput['currency'][] = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'BRL', 'MXN'];

function fromQuote(q: QuoteDTO | null): FormState {
  return {
    title: q?.title ?? '',
    clientName: q?.client.name ?? '', clientEmail: q?.client.email ?? '', clientPhone: q?.client.phone ?? '', clientAddress: q?.client.address ?? '',
    propertyAddress: q?.propertyAddress ?? '', currency: q?.currency ?? 'USD',
    taxRatePct: String(q?.taxRatePct ?? 0), discountType: q?.discountType ?? 'none', discountValue: String(q?.discountValue ?? 0),
    notes: q?.notes ?? '', terms: q?.terms ?? '', validDays: '30', templateKey: q?.templateKey ?? '',
    lineItems: q?.lineItems.map((li) => ({ ...li })) ?? [{ description: '', category: 'Services', quantity: 1, unitPrice: 0 }],
  };
}

export function QuoteBuilder({
  initial, templates, onSaved, onCancel,
}: {
  initial: QuoteDTO | null;
  templates: QuoteTemplate[];
  onSaved: (q: QuoteDTO) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState<FormState>(() => fromQuote(initial));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const totals = computeTotals(f.lineItems, {
    taxRatePct: Number(f.taxRatePct) || 0,
    discountType: f.discountType,
    discountValue: Number(f.discountValue) || 0,
  });

  const applyTemplate = (key: string) => {
    const tpl = templates.find((x) => x.key === key);
    if (!tpl) return;
    setF((s) => ({
      ...s,
      templateKey: key,
      title: s.title || tpl.name,
      terms: tpl.terms,
      lineItems: tpl.lineItems.map((li) => ({ ...li })),
    }));
  };

  const updateRow = (i: number, patch: Partial<LineRow>) =>
    setF((s) => ({ ...s, lineItems: s.lineItems.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = () => setF((s) => ({ ...s, lineItems: [...s.lineItems, { description: '', category: 'Services', quantity: 1, unitPrice: 0 }] }));
  const removeRow = (i: number) => setF((s) => ({ ...s, lineItems: s.lineItems.filter((_, j) => j !== i) }));

  const save = useMutation({
    mutationFn: () => {
      const body: QuoteInput = {
        title: f.title.trim(),
        client: { name: f.clientName.trim(), email: f.clientEmail.trim() || undefined, phone: f.clientPhone.trim() || undefined, address: f.clientAddress.trim() || undefined },
        propertyAddress: f.propertyAddress.trim() || undefined,
        lineItems: f.lineItems.filter((r) => r.description.trim()).map((r) => ({ description: r.description.trim(), category: r.category, quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0 })),
        currency: f.currency, taxRatePct: Number(f.taxRatePct) || 0,
        discountType: f.discountType, discountValue: Number(f.discountValue) || 0,
        notes: f.notes.trim() || undefined, terms: f.terms.trim() || undefined,
        validDays: Number(f.validDays) || 30, templateKey: f.templateKey || undefined,
      };
      return initial
        ? api<{ quote: QuoteDTO }>(`/quotations/${initial._id}`, { method: 'PUT', body })
        : api<{ quote: QuoteDTO }>('/quotations', { method: 'POST', body });
    },
    onSuccess: (res) => onSaved(res.quote),
    onError: (e) => setError(e instanceof ApiError && e.code === 'invalid_input' ? t('quotations.invalid') : t('common.error')),
  });

  const submit = () => {
    setError(null);
    if (!f.title.trim() || !f.clientName.trim() || f.lineItems.every((r) => !r.description.trim())) {
      setError(t('quotations.required'));
      return;
    }
    save.mutate();
  };

  const input = 'h-11 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';
  const label = 'text-xs font-medium text-ink-soft';

  return (
    <Card className="cf-step-in space-y-5">
      <div className="flex items-center justify-between">
        <CardTitle>{initial ? t('quotations.editQuote') : t('quotations.newQuote')}</CardTitle>
        <button onClick={onCancel} className="text-ink-soft hover:text-ink"><X className="h-5 w-5" /></button>
      </div>

      {!initial && (
        <div>
          <p className={label}>{t('quotations.startFrom')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {templates.map((tpl) => (
              <button key={tpl.key} onClick={() => applyTemplate(tpl.key)} title={tpl.description}
                className={`rounded-pill px-3 py-1.5 text-xs transition-colors ${f.templateKey === tpl.key ? 'bg-accent text-accent-on' : 'bg-surface-2 hover:bg-card-purple'}`}>
                {tpl.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="block"><span className={label}>{t('quotations.title')}</span>
        <input className={`mt-1 ${input}`} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Premium Listing Proposal" />
      </label>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className={label}>{t('quotations.clientName')}</span><input className={`mt-1 ${input}`} value={f.clientName} onChange={(e) => set('clientName', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.clientEmail')}</span><input className={`mt-1 ${input}`} value={f.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.clientPhone')}</span><input className={`mt-1 ${input}`} value={f.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.propertyAddress')}</span><input className={`mt-1 ${input}`} value={f.propertyAddress} onChange={(e) => set('propertyAddress', e.target.value)} /></label>
      </div>

      {/* Line items */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className={label}>{t('quotations.lineItems')}</p>
          <Button variant="ghost" size="sm" onClick={addRow}><Plus className="h-4 w-4" /> {t('quotations.addItem')}</Button>
        </div>
        <div className="space-y-2">
          {f.lineItems.map((r, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2">
              <input className={`col-span-6 ${input}`} placeholder={t('quotations.itemDesc')} value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} />
              <input type="number" className={`col-span-2 ${input} text-right`} value={r.quantity} onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })} />
              <input type="number" className={`col-span-3 ${input} text-right`} value={r.unitPrice} onChange={(e) => updateRow(i, { unitPrice: Number(e.target.value) })} />
              <button className="col-span-1 flex justify-center text-ink-soft hover:text-rose-500" onClick={() => removeRow(i)}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </div>

      {/* Money settings + live totals */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={label}>{t('quotations.currency')}</span>
            <select className={`mt-1 ${input}`} value={f.currency} onChange={(e) => set('currency', e.target.value as QuoteInput['currency'])}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="block"><span className={label}>{t('quotations.taxRate')}</span><input type="number" className={`mt-1 ${input}`} value={f.taxRatePct} onChange={(e) => set('taxRatePct', e.target.value)} /></label>
          <label className="block"><span className={label}>{t('quotations.discountType')}</span>
            <select className={`mt-1 ${input}`} value={f.discountType} onChange={(e) => set('discountType', e.target.value as QuoteInput['discountType'])}>
              <option value="none">{t('quotations.none')}</option><option value="percent">%</option><option value="amount">{formatMoney(0, f.currency).replace(/0.*/, '').trim() || 'Amount'}</option>
            </select>
          </label>
          <label className="block"><span className={label}>{t('quotations.discountValue')}</span><input type="number" className={`mt-1 ${input}`} value={f.discountValue} onChange={(e) => set('discountValue', e.target.value)} disabled={f.discountType === 'none'} /></label>
          <label className="block"><span className={label}>{t('quotations.validDays')}</span><input type="number" className={`mt-1 ${input}`} value={f.validDays} onChange={(e) => set('validDays', e.target.value)} /></label>
        </div>
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="flex justify-between py-1 text-sm"><span className="text-ink-soft">{t('quotations.subtotal')}</span><span className="font-medium tabular-nums">{formatMoney(totals.subtotal, f.currency)}</span></div>
          {totals.discountAmount > 0 && <div className="flex justify-between py-1 text-sm"><span className="text-ink-soft">{t('quotations.discount')}</span><span className="tabular-nums text-rose-500">− {formatMoney(totals.discountAmount, f.currency)}</span></div>}
          {totals.taxAmount > 0 && <div className="flex justify-between py-1 text-sm"><span className="text-ink-soft">{t('quotations.tax')}</span><span className="tabular-nums">{formatMoney(totals.taxAmount, f.currency)}</span></div>}
          <div className="mt-2 flex justify-between border-t border-black/10 pt-2 text-lg font-bold"><span>{t('quotations.total')}</span><span className="tabular-nums">{formatMoney(totals.total, f.currency)}</span></div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block"><span className={label}>{t('quotations.notes')}</span><textarea rows={3} className="mt-1 w-full rounded-2xl border border-black/5 bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-ink/10" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.terms')}</span><textarea rows={3} className="mt-1 w-full rounded-2xl border border-black/5 bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-ink/10" value={f.terms} onChange={(e) => set('terms', e.target.value)} /></label>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={save.isPending}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('quotations.saveQuote')}</Button>
        <Button variant="ghost" onClick={onCancel}>{t('quotations.cancel')}</Button>
      </div>
    </Card>
  );
}
