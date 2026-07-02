import { useMutation } from '@tanstack/react-query';
import { BLOCK_TYPES, blockTypeDef, slugify, type Block, type CmsContentInput } from '@truecode/shared';
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { BlockView } from './BlockView';

interface ContentDoc extends CmsContentInput { _id?: string; views?: number }

const uid = () => Math.random().toString(36).slice(2, 10);
const inp = 'h-10 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';
const lbl = 'text-xs font-medium text-ink-soft';

function blank(type: 'page' | 'post'): ContentDoc {
  return { type, title: '', slug: '', status: 'draft', excerpt: '', coverImageUrl: '', blocks: [], seo: {}, tags: [], showInNav: type === 'page', isHome: false, navOrder: 0 };
}

export function CmsEditor({ initial, type, accent, onSaved, onCancel }: {
  initial: ContentDoc | null; type: 'page' | 'post'; accent: string;
  onSaved: (c: ContentDoc) => void; onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState<ContentDoc>(() => initial ?? blank(type));
  const [slugEdited, setSlugEdited] = useState(Boolean(initial?.slug));
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const set = <K extends keyof ContentDoc>(k: K, v: ContentDoc[K]) => setF((s) => ({ ...s, [k]: v }));

  const effectiveSlug = slugEdited ? f.slug : slugify(f.title);

  const setBlocks = (blocks: Block[]) => set('blocks', blocks);
  const addBlock = (bt: string) => { setBlocks([...(f.blocks ?? []), { id: uid(), type: bt, data: {} }]); setShowAdd(false); };
  const updateBlock = (i: number, data: Record<string, unknown>) => setBlocks((f.blocks ?? []).map((b, j) => (j === i ? { ...b, data } : b)));
  const move = (i: number, dir: -1 | 1) => {
    const b = [...(f.blocks ?? [])]; const j = i + dir;
    if (j < 0 || j >= b.length) return;
    [b[i], b[j]] = [b[j]!, b[i]!]; setBlocks(b);
  };
  const removeBlock = (i: number) => setBlocks((f.blocks ?? []).filter((_, j) => j !== i));

  const save = useMutation({
    mutationFn: () => {
      const body: CmsContentInput = {
        type: f.type, title: f.title.trim(), slug: effectiveSlug || undefined, status: f.status,
        excerpt: f.excerpt?.trim() || undefined, coverImageUrl: f.coverImageUrl?.trim() || undefined,
        blocks: f.blocks ?? [], seo: f.seo, tags: f.tags, showInNav: f.showInNav, isHome: f.isHome, navOrder: f.navOrder,
      };
      return initial?._id
        ? api<{ content: ContentDoc }>(`/cms/${initial._id}`, { method: 'PUT', body })
        : api<{ content: ContentDoc }>('/cms', { method: 'POST', body });
    },
    onSuccess: (r) => onSaved(r.content),
    onError: (e) => setError(e instanceof ApiError ? t('cms.saveError') : t('common.error')),
  });

  const preview = useMemo(() => f.blocks ?? [], [f.blocks]);

  return (
    <Card className="cf-step-in">
      <div className="mb-4 flex items-center justify-between">
        <CardTitle>{initial ? t('cms.editContent', { type: t(`cms.${f.type}`) }) : t('cms.newContent', { type: t(`cms.${f.type}`) })}</CardTitle>
        <button onClick={onCancel} className="text-ink-soft hover:text-ink"><X className="h-5 w-5" /></button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Left: settings + blocks */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className={lbl}>{t('cms.title2')}</span>
              <input className={`mt-1 ${inp}`} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder={f.type === 'post' ? '10 tips for first-time buyers' : 'Home'} />
            </label>
            <label className="block"><span className={lbl}>{t('cms.slug')}</span>
              <input className={`mt-1 ${inp}`} value={effectiveSlug} onChange={(e) => { setSlugEdited(true); set('slug', slugify(e.target.value)); }} placeholder="home" />
            </label>
            <label className="block"><span className={lbl}>{t('cms.status')}</span>
              <select className={`mt-1 ${inp}`} value={f.status} onChange={(e) => set('status', e.target.value as 'draft' | 'published')}>
                <option value="draft">{t('cms.draft')}</option><option value="published">{t('cms.published')}</option>
              </select>
            </label>
            <label className="block sm:col-span-2"><span className={lbl}>{t('cms.excerpt')}</span>
              <textarea rows={2} className="mt-1 w-full rounded-2xl border border-black/5 bg-surface p-3 text-sm outline-none focus:ring-2 focus:ring-ink/10" value={f.excerpt} onChange={(e) => set('excerpt', e.target.value)} />
            </label>
            <label className="block sm:col-span-2"><span className={lbl}>{t('cms.coverImage')}</span>
              <input className={`mt-1 ${inp}`} value={f.coverImageUrl} onChange={(e) => set('coverImageUrl', e.target.value)} placeholder="https://…" />
            </label>
            {f.type === 'page' && (
              <div className="flex items-center gap-4 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.showInNav)} onChange={(e) => set('showInNav', e.target.checked)} /> {t('cms.showInNav')}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.isHome)} onChange={(e) => set('isHome', e.target.checked)} /> {t('cms.isHome')}</label>
              </div>
            )}
          </div>

          {/* SEO */}
          <details className="rounded-2xl bg-surface-2 p-3">
            <summary className="cursor-pointer text-sm font-medium">{t('cms.seo')}</summary>
            <div className="mt-3 space-y-2">
              <input className={inp} placeholder={t('cms.metaTitle')} value={f.seo?.metaTitle ?? ''} onChange={(e) => set('seo', { ...f.seo, metaTitle: e.target.value })} />
              <textarea rows={2} className="w-full rounded-2xl border border-black/5 bg-surface p-3 text-sm outline-none" placeholder={t('cms.metaDescription')} value={f.seo?.metaDescription ?? ''} onChange={(e) => set('seo', { ...f.seo, metaDescription: e.target.value })} />
            </div>
          </details>

          {/* Blocks */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className={lbl}>{t('cms.blocks')} ({(f.blocks ?? []).length})</p>
              <Button variant="ghost" size="sm" onClick={() => setShowAdd((s) => !s)}><Plus className="h-4 w-4" /> {t('cms.addBlock')}</Button>
            </div>
            {showAdd && (
              <div className="mb-3 grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-3 sm:grid-cols-3">
                {BLOCK_TYPES.map((bt) => (
                  <button key={bt.type} onClick={() => addBlock(bt.type)} title={bt.description} className="rounded-xl bg-surface px-2 py-2 text-left text-xs transition-colors hover:bg-card-purple">
                    <span className="font-semibold">{bt.label}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-3">
              {(f.blocks ?? []).map((b, i) => {
                const def = blockTypeDef(b.type);
                return (
                  <div key={b.id ?? i} className="rounded-2xl border border-black/5 bg-surface p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <Badge tone="purple">{def?.label ?? b.type}</Badge>
                      <div className="flex items-center gap-1">
                        <button onClick={() => move(i, -1)} className="text-ink-soft hover:text-ink"><ArrowUp className="h-4 w-4" /></button>
                        <button onClick={() => move(i, 1)} className="text-ink-soft hover:text-ink"><ArrowDown className="h-4 w-4" /></button>
                        <button onClick={() => removeBlock(i)} className="text-ink-soft hover:text-rose-500"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {def?.fields.map((field) => {
                        const val = String((b.data as Record<string, unknown>)?.[field.key] ?? '');
                        const onCh = (v: string) => updateBlock(i, { ...(b.data as object), [field.key]: v });
                        if (field.kind === 'textarea' || field.kind === 'lines')
                          return <label key={field.key} className="block"><span className="text-[11px] text-ink-soft">{field.label}</span><textarea rows={field.kind === 'lines' ? 4 : 3} className="mt-0.5 w-full rounded-xl border border-black/5 bg-surface-2 p-2 text-sm outline-none" placeholder={field.placeholder} value={val} onChange={(e) => onCh(e.target.value)} />{field.help && <span className="text-[10px] text-ink-soft">{field.help}</span>}</label>;
                        if (field.kind === 'select')
                          return <label key={field.key} className="block"><span className="text-[11px] text-ink-soft">{field.label}</span><select className="mt-0.5 h-9 w-full rounded-xl border border-black/5 bg-surface-2 px-2 text-sm outline-none" value={val} onChange={(e) => onCh(e.target.value)}>{(field.options ?? []).map((o) => <option key={o}>{o}</option>)}</select></label>;
                        return <label key={field.key} className="block"><span className="text-[11px] text-ink-soft">{field.label}</span><input className="mt-0.5 h-9 w-full rounded-xl border border-black/5 bg-surface-2 px-2 text-sm outline-none" placeholder={field.placeholder} value={val} onChange={(e) => onCh(e.target.value)} /></label>;
                      })}
                      {def?.fields.length === 0 && <p className="text-xs text-ink-soft">{def.description}</p>}
                    </div>
                  </div>
                );
              })}
              {(f.blocks ?? []).length === 0 && <p className="rounded-2xl border border-dashed border-black/10 py-8 text-center text-sm text-ink-soft">{t('cms.noBlocks')}</p>}
            </div>
          </div>

          {error && <p className="text-sm text-rose-500">{error}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={() => f.title.trim() && save.mutate()} disabled={save.isPending || !f.title.trim()}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('cms.save')}</Button>
            <Button variant="ghost" onClick={onCancel}>{t('cms.cancel')}</Button>
          </div>
        </div>

        {/* Right: live preview */}
        <div>
          <p className="mb-2 flex items-center gap-1 text-xs font-medium text-ink-soft"><Eye className="h-3.5 w-3.5" /> {t('cms.livePreview')}</p>
          <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-black/5 bg-white">
            {preview.length === 0 ? <p className="py-24 text-center text-sm text-black/30">{t('cms.previewEmpty')}</p> : preview.map((b, i) => <BlockView key={b.id ?? i} block={b} accent={accent} />)}
          </div>
        </div>
      </div>
    </Card>
  );
}
