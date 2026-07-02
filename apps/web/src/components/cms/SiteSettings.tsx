import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_THEME, type SiteConfigInput } from '@truecode/shared';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Button } from '../ui/button';
import { Card, CardTitle } from '../ui/card';
import { PageSkeleton } from '../ui/skeleton';

const inp = 'h-10 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';
const lbl = 'text-xs font-medium text-ink-soft';

type Config = SiteConfigInput;

export function SiteSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState<Config>({ theme: DEFAULT_THEME, nav: [], contact: {}, social: {}, seo: {} });
  const [saved, setSaved] = useState(false);

  const query = useQuery({ queryKey: ['cms', 'settings'], queryFn: () => api<{ config: Config | null }>('/cms/settings') });
  useEffect(() => {
    if (query.data?.config) setF({ theme: DEFAULT_THEME, nav: [], contact: {}, social: {}, seo: {}, ...query.data.config });
  }, [query.data]);

  const save = useMutation({
    mutationFn: () => api('/cms/settings', { method: 'PUT', body: f }),
    onSuccess: () => { setSaved(true); setTimeout(() => setSaved(false), 2000); void qc.invalidateQueries({ queryKey: ['cms', 'settings'] }); },
  });

  if (query.isLoading) return <PageSkeleton />;
  const theme = f.theme ?? DEFAULT_THEME;
  const setTheme = (k: string, v: string) => setF((s) => ({ ...s, theme: { ...s.theme, [k]: v } }));
  const setContact = (k: string, v: string) => setF((s) => ({ ...s, contact: { ...s.contact, [k]: v } }));
  const setSocial = (k: string, v: string) => setF((s) => ({ ...s, social: { ...s.social, [k]: v } }));
  const nav = f.nav ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <CardTitle className="mb-4">{t('cms.brand')}</CardTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block"><span className={lbl}>{t('cms.brandName')}</span><input className={`mt-1 ${inp}`} value={f.brandName ?? ''} onChange={(e) => setF({ ...f, brandName: e.target.value })} /></label>
          <label className="block"><span className={lbl}>{t('cms.tagline')}</span><input className={`mt-1 ${inp}`} value={f.tagline ?? ''} onChange={(e) => setF({ ...f, tagline: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className={lbl}>{t('cms.logoUrl')}</span><input className={`mt-1 ${inp}`} value={f.logoUrl ?? ''} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://…" /></label>
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-4">{t('cms.theme')}</CardTitle>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(['primaryColor', 'accentColor', 'bgColor'] as const).map((k) => (
            <label key={k} className="block"><span className={lbl}>{t(`cms.${k}`)}</span>
              <div className="mt-1 flex items-center gap-2">
                <input type="color" value={String((theme as Record<string, string>)[k] ?? '#111111')} onChange={(e) => setTheme(k, e.target.value)} className="h-10 w-12 rounded-xl border border-black/5" />
                <input className={inp} value={String((theme as Record<string, string>)[k] ?? '')} onChange={(e) => setTheme(k, e.target.value)} />
              </div>
            </label>
          ))}
          <label className="block"><span className={lbl}>{t('cms.font')}</span>
            <select className={`mt-1 ${inp}`} value={theme.font ?? 'sans'} onChange={(e) => setTheme('font', e.target.value)}><option value="sans">Sans</option><option value="serif">Serif</option></select>
          </label>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle className="mb-4">{t('cms.contact')}</CardTitle>
          <div className="space-y-2">
            <input className={inp} placeholder={t('cms.phone')} value={f.contact?.phone ?? ''} onChange={(e) => setContact('phone', e.target.value)} />
            <input className={inp} placeholder={t('cms.email')} value={f.contact?.email ?? ''} onChange={(e) => setContact('email', e.target.value)} />
            <input className={inp} placeholder={t('cms.address')} value={f.contact?.address ?? ''} onChange={(e) => setContact('address', e.target.value)} />
          </div>
        </Card>
        <Card>
          <CardTitle className="mb-4">{t('cms.social')}</CardTitle>
          <div className="grid grid-cols-2 gap-2">
            {(['facebook', 'instagram', 'linkedin', 'youtube', 'x'] as const).map((k) => (
              <input key={k} className={inp} placeholder={k} value={(f.social as Record<string, string>)?.[k] ?? ''} onChange={(e) => setSocial(k, e.target.value)} />
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <CardTitle>{t('cms.navigation')}</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => setF({ ...f, nav: [...nav, { label: '', href: '' }] })}><Plus className="h-4 w-4" /> {t('cms.addLink')}</Button>
        </div>
        <div className="space-y-2">
          {nav.map((item, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={inp} placeholder={t('cms.linkLabel')} value={item.label} onChange={(e) => setF({ ...f, nav: nav.map((n, j) => (j === i ? { ...n, label: e.target.value } : n)) })} />
              <input className={inp} placeholder="/read/your-site/about" value={item.href} onChange={(e) => setF({ ...f, nav: nav.map((n, j) => (j === i ? { ...n, href: e.target.value } : n)) })} />
              <button className="text-ink-soft hover:text-rose-500" onClick={() => setF({ ...f, nav: nav.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {nav.length === 0 && <p className="text-sm text-ink-soft">{t('cms.noLinks')}</p>}
        </div>
      </Card>

      <Card>
        <CardTitle className="mb-4">{t('cms.footerSeo')}</CardTitle>
        <div className="space-y-2">
          <input className={inp} placeholder={t('cms.footerText')} value={f.footerText ?? ''} onChange={(e) => setF({ ...f, footerText: e.target.value })} />
          <input className={inp} placeholder={t('cms.metaTitle')} value={f.seo?.metaTitle ?? ''} onChange={(e) => setF({ ...f, seo: { ...f.seo, metaTitle: e.target.value } })} />
          <textarea rows={2} className="w-full rounded-2xl border border-black/5 bg-surface p-3 text-sm outline-none" placeholder={t('cms.metaDescription')} value={f.seo?.metaDescription ?? ''} onChange={(e) => setF({ ...f, seo: { ...f.seo, metaDescription: e.target.value } })} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.published)} onChange={(e) => setF({ ...f, published: e.target.checked })} /> {t('cms.sitePublished')}</label>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t('cms.saveSettings')}</Button>
        {saved && <span className="text-sm text-emerald-600">{t('cms.savedOk')}</span>}
      </div>
    </div>
  );
}
