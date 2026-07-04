import { useMutation } from '@tanstack/react-query';
import {
  computeTotals, CURRENCIES, formatMoney, lineNet,
  type Currency, type QuoteDTO, type QuoteInput, type QuoteSettings, type QuoteTemplate,
} from '@truecode/shared';
import {
  BookmarkPlus, ChevronDown, ChevronUp, Copy, Loader2, Plus, Save, Sparkles, Trash2, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';

interface LineRow {
  description: string; category?: string; unit?: string;
  quantity: number; unitPrice: number; discountPct?: number;
  taxable?: boolean; optional?: boolean;
}

interface FormState {
  title: string; clientName: string; clientCompany: string; clientEmail: string; clientPhone: string; clientAddress: string;
  propertyAddress: string; summary: string; currency: Currency; taxRatePct: string; taxLabel: string;
  discountType: QuoteInput['discountType']; discountValue: string;
  depositType: QuoteInput['depositType']; depositValue: string;
  notes: string; terms: string; validDays: string; templateKey: string;
  accentColor: string; logoUrl: string; lineItems: LineRow[];
}

const DEFAULT_ACCENT = '#111111';

function fromQuote(q: QuoteDTO | null, defaults: QuoteSettings): FormState {
  return {
    title: q?.title ?? '',
    clientName: q?.client.name ?? '', clientCompany: q?.client.company ?? '', clientEmail: q?.client.email ?? '',
    clientPhone: q?.client.phone ?? '', clientAddress: q?.client.address ?? '',
    propertyAddress: q?.propertyAddress ?? '', summary: q?.summary ?? '',
    currency: q?.currency ?? defaults.defaultCurrency ?? 'USD',
    taxRatePct: String(q?.taxRatePct ?? defaults.defaultTaxRatePct ?? 0), taxLabel: q?.taxLabel ?? '',
    discountType: q?.discountType ?? 'none', discountValue: String(q?.discountValue ?? 0),
    depositType: q?.depositType ?? 'none', depositValue: String(q?.depositValue ?? 0),
    notes: q?.notes ?? defaults.defaultNotes ?? '', terms: q?.terms ?? defaults.defaultTerms ?? '',
    validDays: String(defaults.defaultValidDays ?? 30), templateKey: q?.templateKey ?? '',
    accentColor: q?.accentColor ?? defaults.accentColor ?? DEFAULT_ACCENT, logoUrl: q?.logoUrl ?? defaults.logoUrl ?? '',
    lineItems: q?.lineItems.map((li) => ({ ...li })) ?? [{ description: '', category: 'Services', quantity: 1, unitPrice: 0, taxable: true }],
  };
}

export function QuoteBuilder({
  initial, templates, categories, defaults, onSaved, onCancel, onTemplatesChanged,
}: {
  initial: QuoteDTO | null;
  templates: QuoteTemplate[];
  categories: string[];
  defaults: QuoteSettings;
  onSaved: (q: QuoteDTO) => void;
  onCancel: () => void;
  onTemplatesChanged?: () => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState<FormState>(() => fromQuote(initial, defaults));
  const [error, setError] = useState<string | null>(null);
  const [showGallery, setShowGallery] = useState(!initial);
  const [savedTpl, setSavedTpl] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));

  const totals = useMemo(() => computeTotals(
    f.lineItems.map((r) => ({ ...r, quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0, discountPct: r.discountPct ? Number(r.discountPct) : undefined })),
    {
      taxRatePct: Number(f.taxRatePct) || 0, discountType: f.discountType, discountValue: Number(f.discountValue) || 0,
      depositType: f.depositType, depositValue: Number(f.depositValue) || 0,
    },
  ), [f.lineItems, f.taxRatePct, f.discountType, f.discountValue, f.depositType, f.depositValue]);

  // Categories available for the datalist: managed list + anything already typed.
  const catOptions = useMemo(() => {
    const set2 = new Set<string>(categories);
    f.lineItems.forEach((r) => r.category && set2.add(r.category));
    return Array.from(set2).sort();
  }, [categories, f.lineItems]);

  const applyTemplate = (tpl: QuoteTemplate) => {
    setF((s) => ({
      ...s,
      templateKey: tpl.key,
      title: s.title || tpl.name,
      terms: tpl.terms || s.terms,
      notes: tpl.notes ?? s.notes,
      currency: tpl.currency ?? s.currency,
      taxRatePct: tpl.defaultTaxRatePct != null ? String(tpl.defaultTaxRatePct) : s.taxRatePct,
      accentColor: tpl.accentColor ?? s.accentColor,
      lineItems: tpl.lineItems.map((li) => ({ ...li })),
    }));
    setShowGallery(false);
  };

  const updateRow = (i: number, patch: Partial<LineRow>) =>
    setF((s) => ({ ...s, lineItems: s.lineItems.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addRow = () => setF((s) => ({ ...s, lineItems: [...s.lineItems, { description: '', category: catOptions[0] ?? 'Services', quantity: 1, unitPrice: 0, taxable: true }] }));
  const duplicateRow = (i: number) => setF((s) => ({ ...s, lineItems: s.lineItems.flatMap((r, j) => (j === i ? [r, { ...r }] : [r])) }));
  const removeRow = (i: number) => setF((s) => ({ ...s, lineItems: s.lineItems.filter((_, j) => j !== i) }));
  const moveRow = (i: number, dir: -1 | 1) => setF((s) => {
    const j = i + dir;
    if (j < 0 || j >= s.lineItems.length) return s;
    const li = [...s.lineItems];
    const tmp = li[i]!;
    li[i] = li[j]!;
    li[j] = tmp;
    return { ...s, lineItems: li };
  });

  const buildBody = (): QuoteInput => ({
    title: f.title.trim(),
    client: {
      name: f.clientName.trim(), company: f.clientCompany.trim() || undefined, email: f.clientEmail.trim() || undefined,
      phone: f.clientPhone.trim() || undefined, address: f.clientAddress.trim() || undefined,
    },
    propertyAddress: f.propertyAddress.trim() || undefined,
    summary: f.summary.trim() || undefined,
    lineItems: f.lineItems.filter((r) => r.description.trim()).map((r) => ({
      description: r.description.trim(), category: r.category?.trim() || undefined, unit: r.unit?.trim() || undefined,
      quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0,
      discountPct: r.discountPct ? Number(r.discountPct) : undefined,
      taxable: r.taxable !== false, optional: !!r.optional,
    })),
    currency: f.currency, taxRatePct: Number(f.taxRatePct) || 0, taxLabel: f.taxLabel.trim() || undefined,
    discountType: f.discountType, discountValue: Number(f.discountValue) || 0,
    depositType: f.depositType, depositValue: Number(f.depositValue) || 0,
    notes: f.notes.trim() || undefined, terms: f.terms.trim() || undefined,
    validDays: Number(f.validDays) || 30, templateKey: f.templateKey || undefined,
    accentColor: f.accentColor || undefined, logoUrl: f.logoUrl.trim() || undefined,
  });

  const save = useMutation({
    mutationFn: () => {
      const body = buildBody();
      return initial
        ? api<{ quote: QuoteDTO }>(`/quotations/${initial._id}`, { method: 'PUT', body })
        : api<{ quote: QuoteDTO }>('/quotations', { method: 'POST', body });
    },
    onSuccess: (res) => onSaved(res.quote),
    onError: (e) => setError(e instanceof ApiError && e.code === 'invalid_input' ? t('quotations.invalid') : t('common.error')),
  });

  const saveAsTemplate = useMutation({
    mutationFn: () => {
      const b = buildBody();
      return api('/quotations/templates', {
        method: 'POST',
        body: {
          name: (b.title || 'Template').slice(0, 120), description: '', category: 'Custom',
          terms: b.terms ?? '', notes: b.notes, defaultTaxRatePct: b.taxRatePct,
          accentColor: b.accentColor, currency: b.currency, lineItems: b.lineItems,
        },
      });
    },
    onSuccess: () => { setSavedTpl(true); onTemplatesChanged?.(); setTimeout(() => setSavedTpl(false), 2500); },
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
  const inputSm = 'h-10 w-full rounded-xl border border-black/5 bg-surface px-2.5 text-sm outline-none focus:ring-2 focus:ring-ink/10';
  const label = 'text-xs font-medium text-ink-soft';
  const sym = formatMoney(0, f.currency).replace(/[\d.,\s]/g, '') || '$';

  // Group the built-in + custom templates by category for the gallery.
  const grouped = useMemo(() => {
    const map = new Map<string, QuoteTemplate[]>();
    for (const tpl of templates) {
      const k = tpl.custom ? `★ ${tpl.category}` : tpl.category;
      (map.get(k) ?? map.set(k, []).get(k)!).push(tpl);
    }
    return Array.from(map.entries());
  }, [templates]);

  return (
    <Card className="cf-step-in space-y-5">
      <div className="flex items-center justify-between">
        <CardTitle>{initial ? `${t('quotations.editQuote')} · ${initial.number}` : t('quotations.newQuote')}</CardTitle>
        <button onClick={onCancel} className="text-ink-soft hover:text-ink" aria-label={t('quotations.cancel')}><X className="h-5 w-5" /></button>
      </div>

      {/* Template gallery */}
      <div className="rounded-2xl border border-black/5 bg-surface-2/50 p-3">
        <button onClick={() => setShowGallery((v) => !v)} className="flex w-full items-center justify-between text-left">
          <span className="flex items-center gap-2 text-sm font-medium"><Sparkles className="h-4 w-4" /> {t('quotations.startFrom')}</span>
          {showGallery ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {showGallery && (
          <div className="mt-3 space-y-3">
            {grouped.map(([cat, tpls]) => (
              <div key={cat}>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{cat}</p>
                <div className="flex flex-wrap gap-2">
                  {tpls.map((tpl) => (
                    <button key={tpl.key} onClick={() => applyTemplate(tpl)} title={tpl.description}
                      className={cn('rounded-pill px-3 py-1.5 text-xs transition-colors',
                        f.templateKey === tpl.key ? 'bg-accent text-accent-on' : 'bg-surface hover:bg-card-purple')}>
                      {tpl.custom && <span className="mr-1">★</span>}{tpl.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <label className="block"><span className={label}>{t('quotations.title')}</span>
        <input className={`mt-1 ${input}`} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Premium Listing Proposal" />
      </label>

      {/* Client + property */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block"><span className={label}>{t('quotations.clientName')} *</span><input className={`mt-1 ${input}`} value={f.clientName} onChange={(e) => set('clientName', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.clientCompany')}</span><input className={`mt-1 ${input}`} value={f.clientCompany} onChange={(e) => set('clientCompany', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.clientEmail')}</span><input className={`mt-1 ${input}`} value={f.clientEmail} onChange={(e) => set('clientEmail', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.clientPhone')}</span><input className={`mt-1 ${input}`} value={f.clientPhone} onChange={(e) => set('clientPhone', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.clientAddress')}</span><input className={`mt-1 ${input}`} value={f.clientAddress} onChange={(e) => set('clientAddress', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.propertyAddress')}</span><input className={`mt-1 ${input}`} value={f.propertyAddress} onChange={(e) => set('propertyAddress', e.target.value)} /></label>
      </div>

      <label className="block"><span className={label}>{t('quotations.summary')}</span>
        <textarea rows={2} className="mt-1 w-full rounded-2xl border border-black/5 bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-ink/10" value={f.summary} onChange={(e) => set('summary', e.target.value)} placeholder={t('quotations.summaryHint')} />
      </label>

      {/* Line items */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className={label}>{t('quotations.lineItems')} ({f.lineItems.length})</p>
          <Button variant="ghost" size="sm" onClick={addRow}><Plus className="h-4 w-4" /> {t('quotations.addItem')}</Button>
        </div>
        <datalist id="cf-cats">{catOptions.map((c) => <option key={c} value={c} />)}</datalist>
        <div className="space-y-2">
          {f.lineItems.map((r, i) => (
            <div key={i} className={cn('rounded-2xl border border-black/5 bg-surface-2/40 p-2.5', r.optional && 'border-dashed border-accent/40')}>
              <div className="flex items-center gap-2">
                <input className={`flex-1 ${inputSm}`} placeholder={t('quotations.itemDesc')} value={r.description} onChange={(e) => updateRow(i, { description: e.target.value })} />
                <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums text-ink-soft">{formatMoney(lineNet({ quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0, discountPct: r.discountPct ? Number(r.discountPct) : undefined }), f.currency)}</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-12">
                <input list="cf-cats" className={`sm:col-span-4 ${inputSm}`} placeholder={t('quotations.category')} value={r.category ?? ''} onChange={(e) => updateRow(i, { category: e.target.value })} />
                <input className={`sm:col-span-2 ${inputSm}`} placeholder={t('quotations.unit')} value={r.unit ?? ''} onChange={(e) => updateRow(i, { unit: e.target.value })} />
                <input type="number" min={0} className={`sm:col-span-2 ${inputSm} text-right`} title={t('quotations.qty')} value={r.quantity} onChange={(e) => updateRow(i, { quantity: Number(e.target.value) })} />
                <input type="number" min={0} className={`sm:col-span-2 ${inputSm} text-right`} title={t('quotations.unitPrice')} value={r.unitPrice} onChange={(e) => updateRow(i, { unitPrice: Number(e.target.value) })} />
                <input type="number" min={0} max={100} className={`sm:col-span-2 ${inputSm} text-right`} title={t('quotations.lineDiscount')} placeholder="%" value={r.discountPct ?? ''} onChange={(e) => updateRow(i, { discountPct: e.target.value === '' ? undefined : Number(e.target.value) })} />
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs">
                <label className="flex items-center gap-1.5 text-ink-soft"><input type="checkbox" checked={r.taxable !== false} onChange={(e) => updateRow(i, { taxable: e.target.checked })} /> {t('quotations.taxable')}</label>
                <label className="flex items-center gap-1.5 text-ink-soft"><input type="checkbox" checked={!!r.optional} onChange={(e) => updateRow(i, { optional: e.target.checked })} /> {t('quotations.optional')}</label>
                <div className="ml-auto flex items-center gap-1 text-ink-soft">
                  <button onClick={() => moveRow(i, -1)} disabled={i === 0} className="rounded p-1 hover:bg-black/5 disabled:opacity-30" title={t('quotations.moveUp')}><ChevronUp className="h-4 w-4" /></button>
                  <button onClick={() => moveRow(i, 1)} disabled={i === f.lineItems.length - 1} className="rounded p-1 hover:bg-black/5 disabled:opacity-30" title={t('quotations.moveDown')}><ChevronDown className="h-4 w-4" /></button>
                  <button onClick={() => duplicateRow(i)} className="rounded p-1 hover:bg-black/5" title={t('quotations.duplicate')}><Copy className="h-4 w-4" /></button>
                  <button onClick={() => removeRow(i)} disabled={f.lineItems.length === 1} className="rounded p-1 hover:bg-black/5 hover:text-rose-500 disabled:opacity-30" title={t('common.delete')}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Money settings + live totals */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={label}>{t('quotations.currency')}</span>
            <select className={`mt-1 ${input}`} value={f.currency} onChange={(e) => set('currency', e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label className="block"><span className={label}>{t('quotations.taxRate')}</span><input type="number" min={0} className={`mt-1 ${input}`} value={f.taxRatePct} onChange={(e) => set('taxRatePct', e.target.value)} /></label>
          <label className="block"><span className={label}>{t('quotations.taxLabel')}</span><input className={`mt-1 ${input}`} value={f.taxLabel} onChange={(e) => set('taxLabel', e.target.value)} placeholder="VAT / GST / Sales tax" /></label>
          <label className="block"><span className={label}>{t('quotations.validDays')}</span><input type="number" min={1} className={`mt-1 ${input}`} value={f.validDays} onChange={(e) => set('validDays', e.target.value)} /></label>
          <label className="block"><span className={label}>{t('quotations.discountType')}</span>
            <select className={`mt-1 ${input}`} value={f.discountType} onChange={(e) => set('discountType', e.target.value as QuoteInput['discountType'])}>
              <option value="none">{t('quotations.none')}</option><option value="percent">%</option><option value="amount">{sym}</option>
            </select>
          </label>
          <label className="block"><span className={label}>{t('quotations.discountValue')}</span><input type="number" min={0} className={`mt-1 ${input}`} value={f.discountValue} onChange={(e) => set('discountValue', e.target.value)} disabled={f.discountType === 'none'} /></label>
          <label className="block"><span className={label}>{t('quotations.depositType')}</span>
            <select className={`mt-1 ${input}`} value={f.depositType} onChange={(e) => set('depositType', e.target.value as QuoteInput['depositType'])}>
              <option value="none">{t('quotations.none')}</option><option value="percent">%</option><option value="amount">{sym}</option>
            </select>
          </label>
          <label className="block"><span className={label}>{t('quotations.depositValue')}</span><input type="number" min={0} className={`mt-1 ${input}`} value={f.depositValue} onChange={(e) => set('depositValue', e.target.value)} disabled={f.depositType === 'none'} /></label>
        </div>
        <div className="rounded-2xl bg-surface-2 p-4">
          <div className="flex justify-between py-1 text-sm"><span className="text-ink-soft">{t('quotations.subtotal')}</span><span className="font-medium tabular-nums">{formatMoney(totals.subtotal, f.currency)}</span></div>
          {totals.discountAmount > 0 && <div className="flex justify-between py-1 text-sm"><span className="text-ink-soft">{t('quotations.discount')}</span><span className="tabular-nums text-rose-500">− {formatMoney(totals.discountAmount, f.currency)}</span></div>}
          {totals.taxAmount > 0 && <div className="flex justify-between py-1 text-sm"><span className="text-ink-soft">{f.taxLabel.trim() || t('quotations.tax')} ({f.taxRatePct}%)</span><span className="tabular-nums">{formatMoney(totals.taxAmount, f.currency)}</span></div>}
          <div className="mt-2 flex justify-between border-t border-black/10 pt-2 text-lg font-bold"><span>{t('quotations.total')}</span><span className="tabular-nums">{formatMoney(totals.total, f.currency)}</span></div>
          {totals.depositAmount > 0 && (
            <div className="mt-2 space-y-1 border-t border-black/10 pt-2 text-sm">
              <div className="flex justify-between"><span className="text-ink-soft">{t('quotations.depositDue')}</span><span className="font-medium tabular-nums text-emerald-600">{formatMoney(totals.depositAmount, f.currency)}</span></div>
              <div className="flex justify-between"><span className="text-ink-soft">{t('quotations.balanceDue')}</span><span className="tabular-nums">{formatMoney(totals.balanceDue, f.currency)}</span></div>
            </div>
          )}
          {totals.optionalTotal > 0 && <div className="mt-2 flex justify-between border-t border-dashed border-black/10 pt-2 text-xs text-ink-soft"><span>{t('quotations.optionalAddOns')}</span><span className="tabular-nums">+ {formatMoney(totals.optionalTotal, f.currency)}</span></div>}
        </div>
      </div>

      {/* Branding + notes/terms */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-end gap-3">
          <label className="block"><span className={label}>{t('quotations.accentColor')}</span>
            <input type="color" className="mt-1 h-11 w-16 cursor-pointer rounded-2xl border border-black/5 bg-surface p-1" value={f.accentColor} onChange={(e) => set('accentColor', e.target.value)} />
          </label>
          <label className="block flex-1"><span className={label}>{t('quotations.logoUrl')}</span><input className={`mt-1 ${input}`} value={f.logoUrl} onChange={(e) => set('logoUrl', e.target.value)} placeholder="https://…/logo.png" /></label>
        </div>
        <div />
        <label className="block"><span className={label}>{t('quotations.notes')}</span><textarea rows={3} className="mt-1 w-full rounded-2xl border border-black/5 bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-ink/10" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
        <label className="block"><span className={label}>{t('quotations.terms')}</span><textarea rows={3} className="mt-1 w-full rounded-2xl border border-black/5 bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-ink/10" value={f.terms} onChange={(e) => set('terms', e.target.value)} /></label>
      </div>

      {error && <p className="text-sm text-rose-500">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={save.isPending}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('quotations.saveQuote')}</Button>
        <Button variant="secondary" onClick={() => saveAsTemplate.mutate()} disabled={saveAsTemplate.isPending}>
          {saveAsTemplate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookmarkPlus className="h-4 w-4" />} {savedTpl ? t('quotations.templateSaved') : t('quotations.saveAsTemplate')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>{t('quotations.cancel')}</Button>
      </div>
    </Card>
  );
}
