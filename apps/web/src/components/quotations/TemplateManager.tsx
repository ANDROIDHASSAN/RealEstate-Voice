import { useMutation } from '@tanstack/react-query';
import {
  CURRENCIES, formatMoney, lineNet,
  type Currency, type CustomTemplateInput, type QuoteSettings, type QuoteTemplate,
} from '@truecode/shared';
import {
  Download, FolderPlus, Loader2, Pencil, Plus, Save, Trash2, Upload, X,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';

interface Row { description: string; category?: string; unit?: string; quantity: number; unitPrice: number; discountPct?: number; taxable?: boolean; optional?: boolean }

const blankTemplate = (): CustomTemplateInput => ({
  name: '', description: '', category: 'Custom', terms: '', currency: 'USD',
  lineItems: [{ description: '', category: 'Services', quantity: 1, unitPrice: 0 }],
});

function TemplateEditor({ initial, onDone, onCancel }: { initial: QuoteTemplate | null; onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'Custom');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [terms, setTerms] = useState(initial?.terms ?? '');
  const [currency, setCurrency] = useState<Currency>((initial?.currency as Currency) ?? 'USD');
  const [taxRate, setTaxRate] = useState(String(initial?.defaultTaxRatePct ?? ''));
  const [rows, setRows] = useState<Row[]>(initial?.lineItems.map((li) => ({ ...li })) ?? blankTemplate().lineItems);
  const [error, setError] = useState<string | null>(null);

  const input = 'h-10 w-full rounded-xl border border-black/5 bg-surface px-2.5 text-sm outline-none focus:ring-2 focus:ring-ink/10';
  const update = (i: number, patch: Partial<Row>) => setRows((s) => s.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => {
      const body: CustomTemplateInput = {
        name: name.trim(), description: description.trim(), category: category.trim() || 'Custom',
        terms: terms.trim(), currency, defaultTaxRatePct: taxRate === '' ? undefined : Number(taxRate),
        lineItems: rows.filter((r) => r.description.trim()).map((r) => ({
          description: r.description.trim(), category: r.category?.trim() || undefined, unit: r.unit?.trim() || undefined,
          quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0,
          discountPct: r.discountPct ? Number(r.discountPct) : undefined, taxable: r.taxable !== false, optional: !!r.optional,
        })),
      };
      return initial?._id
        ? api(`/quotations/templates/${initial._id}`, { method: 'PUT', body })
        : api('/quotations/templates', { method: 'POST', body });
    },
    onSuccess: onDone,
    onError: (e) => setError(e instanceof ApiError && e.code === 'invalid_input' ? t('quotations.invalid') : t('common.error')),
  });

  const submit = () => {
    setError(null);
    if (name.trim().length < 2 || rows.every((r) => !r.description.trim())) { setError(t('quotations.required')); return; }
    save.mutate();
  };

  return (
    <div className="rounded-2xl border border-accent/30 bg-surface-2/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">{initial?._id ? t('quotations.editTemplate') : t('quotations.newTemplate')}</p>
        <button onClick={onCancel} className="text-ink-soft hover:text-ink"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input className={input} placeholder={t('quotations.templateName')} value={name} onChange={(e) => setName(e.target.value)} />
        <input className={input} placeholder={t('quotations.category')} value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <input className={`mt-2 ${input}`} placeholder={t('quotations.description')} value={description} onChange={(e) => setDescription(e.target.value)} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <select className={input} value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
        <input type="number" min={0} className={input} placeholder={t('quotations.taxRate')} value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
      </div>

      <p className="mt-3 mb-1 text-xs font-medium text-ink-soft">{t('quotations.lineItems')}</p>
      <div className="space-y-1.5">
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-12 items-center gap-1.5">
            <input className={`col-span-5 ${input}`} placeholder={t('quotations.itemDesc')} value={r.description} onChange={(e) => update(i, { description: e.target.value })} />
            <input className={`col-span-3 ${input}`} placeholder={t('quotations.category')} value={r.category ?? ''} onChange={(e) => update(i, { category: e.target.value })} />
            <input type="number" min={0} className={`col-span-1 ${input} text-right`} title={t('quotations.qty')} value={r.quantity} onChange={(e) => update(i, { quantity: Number(e.target.value) })} />
            <input type="number" min={0} className={`col-span-2 ${input} text-right`} title={t('quotations.unitPrice')} value={r.unitPrice} onChange={(e) => update(i, { unitPrice: Number(e.target.value) })} />
            <button className="col-span-1 flex justify-center text-ink-soft hover:text-rose-500" onClick={() => setRows((s) => s.filter((_, j) => j !== i))} disabled={rows.length === 1}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => setRows((s) => [...s, { description: '', category: 'Services', quantity: 1, unitPrice: 0 }])}><Plus className="h-4 w-4" /> {t('quotations.addItem')}</Button>
        <span className="text-xs text-ink-soft">{t('quotations.total')}: <span className="font-medium tabular-nums">{formatMoney(rows.reduce((s, r) => s + (r.optional ? 0 : lineNet({ quantity: Number(r.quantity) || 0, unitPrice: Number(r.unitPrice) || 0, discountPct: r.discountPct })), 0), currency)}</span></span>
      </div>
      <input className={`mt-2 ${input}`} placeholder={t('quotations.terms')} value={terms} onChange={(e) => setTerms(e.target.value)} />
      {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={submit} disabled={save.isPending}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('quotations.saveTemplate')}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t('quotations.cancel')}</Button>
      </div>
    </div>
  );
}

export function TemplateManager({
  customTemplates, settings, onChanged, onClose,
}: {
  customTemplates: QuoteTemplate[];
  settings: QuoteSettings;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<QuoteTemplate | null | 'new'>(null);
  const [newCat, setNewCat] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const del = useMutation({
    mutationFn: (id: string) => api(`/quotations/templates/${id}`, { method: 'DELETE' }),
    onSuccess: onChanged,
  });

  const saveSettings = useMutation({
    mutationFn: (categories: string[]) => api('/quotations/settings', { method: 'PUT', body: { ...settings, categories } }),
    onSuccess: onChanged,
  });

  const importTpl = useMutation({
    mutationFn: (payload: unknown) => api('/quotations/templates/import', { method: 'POST', body: payload }),
    onSuccess: onChanged,
    onError: () => setImportError(t('quotations.importError')),
  });

  const onFile = async (file: File) => {
    setImportError(null);
    try {
      const parsed = JSON.parse(await file.text());
      importTpl.mutate(parsed);
    } catch {
      setImportError(t('quotations.importError'));
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const exportTpl = (tpl: QuoteTemplate) => {
    const payload = {
      name: tpl.name, description: tpl.description, category: tpl.category, terms: tpl.terms,
      currency: tpl.currency, defaultTaxRatePct: tpl.defaultTaxRatePct, accentColor: tpl.accentColor, lineItems: tpl.lineItems,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${tpl.name.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addCat = () => {
    const c = newCat.trim();
    if (!c || settings.categories.includes(c)) { setNewCat(''); return; }
    saveSettings.mutate([...settings.categories, c]);
    setNewCat('');
  };
  const removeCat = (c: string) => saveSettings.mutate(settings.categories.filter((x) => x !== c));

  return (
    <Card className="cf-step-in space-y-5">
      <div className="flex items-center justify-between">
        <CardTitle>{t('quotations.manageTemplates')}</CardTitle>
        <button onClick={onClose} className="text-ink-soft hover:text-ink"><X className="h-5 w-5" /></button>
      </div>

      {/* Categories */}
      <div>
        <p className="mb-2 text-xs font-medium text-ink-soft">{t('quotations.categories')} ({settings.categories.length})</p>
        <div className="flex flex-wrap items-center gap-2">
          {settings.categories.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-pill bg-surface-2 px-3 py-1 text-xs">
              {c}
              <button onClick={() => removeCat(c)} className="text-ink-soft hover:text-rose-500"><X className="h-3 w-3" /></button>
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <input className="h-8 w-36 rounded-pill border border-black/5 bg-surface px-3 text-xs outline-none focus:ring-2 focus:ring-ink/10"
              placeholder={t('quotations.addCategory')} value={newCat} onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCat(); } }} />
            <button onClick={addCat} className="rounded-pill bg-accent p-1.5 text-accent-on" title={t('quotations.addCategory')}><FolderPlus className="h-3.5 w-3.5" /></button>
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 border-y border-black/5 py-3">
        <Button size="sm" onClick={() => setEditing('new')}><Plus className="h-4 w-4" /> {t('quotations.newTemplate')}</Button>
        <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> {t('quotations.importTemplate')}</Button>
        <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void onFile(file); }} />
      </div>
      {importError && <p className="text-sm text-rose-500">{importError}</p>}

      {editing && (
        <TemplateEditor
          initial={editing === 'new' ? null : editing}
          onDone={() => { setEditing(null); onChanged(); }}
          onCancel={() => setEditing(null)}
        />
      )}

      {/* Custom template list */}
      <div className="space-y-2">
        {customTemplates.length === 0 && !editing && (
          <p className="rounded-2xl bg-surface-2/50 py-8 text-center text-sm text-ink-soft">{t('quotations.noCustomTemplates')}</p>
        )}
        {customTemplates.map((tpl) => (
          <div key={tpl.key} className={cn('flex items-center gap-3 rounded-2xl border border-black/5 bg-surface p-3', editing !== 'new' && editing?._id === tpl._id && 'ring-2 ring-accent')}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">★ {tpl.name}</p>
              <p className="text-xs text-ink-soft">{tpl.category} · {tpl.lineItems.length} {t('quotations.items')}</p>
            </div>
            <button onClick={() => setEditing(tpl)} className="rounded-lg p-2 text-ink-soft hover:bg-black/5 hover:text-ink" title={t('quotations.edit')}><Pencil className="h-4 w-4" /></button>
            <button onClick={() => exportTpl(tpl)} className="rounded-lg p-2 text-ink-soft hover:bg-black/5 hover:text-ink" title={t('quotations.export')}><Download className="h-4 w-4" /></button>
            <button onClick={() => tpl._id && del.mutate(tpl._id)} className="rounded-lg p-2 text-ink-soft hover:bg-black/5 hover:text-rose-500" title={t('common.delete')}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </Card>
  );
}
