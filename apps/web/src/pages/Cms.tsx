import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_THEME, type CmsContentInput } from '@truecode/shared';
import { Copy, ExternalLink, Eye, Globe, LayoutTemplate, Newspaper, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CmsEditor } from '../components/cms/CmsEditor';
import { SiteSettings } from '../components/cms/SiteSettings';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/auth';

interface ContentRow extends CmsContentInput { _id: string; views?: number; updatedAt?: string }
interface Stats { pages: number; posts: number; published: number; drafts: number; views: number }

type Tab = 'page' | 'post' | 'settings';

export default function Cms() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const account = useAuthStore((s) => s.account);
  const [tab, setTab] = useState<Tab>('page');
  const [editor, setEditor] = useState<{ open: boolean; content: ContentRow | null }>({ open: false, content: null });

  const settings = useQuery({ queryKey: ['cms', 'settings'], queryFn: () => api<{ config: { theme?: { accentColor?: string } } | null }>('/cms/settings') });
  const list = useQuery({ queryKey: ['cms', 'content'], queryFn: () => api<{ items: ContentRow[] }>('/cms') });
  const stats = useQuery({ queryKey: ['cms', 'stats'], queryFn: () => api<{ stats: Stats }>('/cms/stats') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['cms'] }); };
  const accent = settings.data?.config?.theme?.accentColor ?? DEFAULT_THEME.accentColor;

  const act = useMutation({
    mutationFn: (a: { id: string; kind: 'publish' | 'unpublish' | 'duplicate' | 'delete' }) =>
      a.kind === 'delete' ? api(`/cms/${a.id}`, { method: 'DELETE' }) : api(`/cms/${a.id}/${a.kind}`, { method: 'POST' }),
    onSuccess: refresh,
  });

  if (list.isLoading) return <PageSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  const items = list.data!.items.filter((c) => c.type === tab);
  const s = stats.data?.stats;
  const siteSlug = account?.websiteSlug;
  const publicUrl = (slug?: string) => siteSlug ? `${location.origin}/read/${siteSlug}${slug ? `/${slug}` : ''}` : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('cms.title')}
        subtitle={t('cms.subtitle')}
        action={siteSlug ? (
          <a href={publicUrl() ?? '#'} target="_blank" rel="noreferrer"><Button variant="secondary"><Globe className="h-4 w-4" /> {t('cms.viewSite')}</Button></a>
        ) : undefined}
      />

      <div className="grid grid-cols-2 gap-5 xl:grid-cols-4">
        <StatCard icon={LayoutTemplate} tone="blue" value={s?.pages ?? 0} label={t('cms.pages')} />
        <StatCard icon={Newspaper} tone="purple" value={s?.posts ?? 0} label={t('cms.posts')} />
        <StatCard icon={Globe} tone="green" value={s?.published ?? 0} label={t('cms.publishedCount')} />
        <StatCard icon={Eye} tone="yellow" value={s?.views ?? 0} label={t('cms.totalViews')} />
      </div>

      {!siteSlug && (
        <Card tone="yellow"><p className="text-sm">{t('cms.noSlug')} <a href="/website" className="font-medium underline">{t('cms.goWebsite')}</a></p></Card>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        {(['page', 'post', 'settings'] as Tab[]).map((tb) => (
          <button key={tb} onClick={() => { setTab(tb); setEditor({ open: false, content: null }); }}
            className={cn('rounded-pill px-4 py-2 text-sm font-medium transition-colors', tab === tb ? 'bg-accent text-accent-on' : 'bg-surface-2 hover:bg-black/5')}>
            {t(`cms.tab_${tb}`)}
          </button>
        ))}
        {tab !== 'settings' && !editor.open && (
          <Button className="ml-auto" onClick={() => setEditor({ open: true, content: null })}><Plus className="h-4 w-4" /> {t(tab === 'page' ? 'cms.newPage' : 'cms.newPost')}</Button>
        )}
      </div>

      {tab === 'settings' ? (
        <SiteSettings />
      ) : editor.open ? (
        <CmsEditor
          initial={editor.content}
          type={tab}
          accent={accent}
          onSaved={() => { setEditor({ open: false, content: null }); refresh(); }}
          onCancel={() => setEditor({ open: false, content: null })}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={tab === 'page' ? LayoutTemplate : Newspaper} title={t(tab === 'page' ? 'cms.noPages' : 'cms.noPosts')} hint={t('cms.emptyHint')} action={<Button onClick={() => setEditor({ open: true, content: null })}><Plus className="h-4 w-4" /> {t(tab === 'page' ? 'cms.newPage' : 'cms.newPost')}</Button>} />
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <Card key={c._id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-semibold">{c.title}</p>
                  {c.isHome && <Badge tone="ink">{t('cms.home')}</Badge>}
                  <Badge tone={c.status === 'published' ? 'green' : 'neutral'}>{t(`cms.${c.status}`)}</Badge>
                </div>
                <p className="text-xs text-ink-soft">/{c.slug} · {c.views ?? 0} {t('cms.views')} {c.showInNav && `· ${t('cms.inNav')}`}</p>
              </div>
              {siteSlug && c.status === 'published' && (
                <a href={publicUrl(c.slug) ?? '#'} target="_blank" rel="noreferrer" className="text-ink-soft hover:text-ink"><ExternalLink className="h-4 w-4" /></a>
              )}
              <Button size="sm" variant="secondary" onClick={() => setEditor({ open: true, content: c })}>{t('cms.edit')}</Button>
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: c._id, kind: c.status === 'published' ? 'unpublish' : 'publish' })}>
                {c.status === 'published' ? t('cms.unpublish') : t('cms.publish')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => act.mutate({ id: c._id, kind: 'duplicate' })}><Copy className="h-4 w-4" /></Button>
              <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => act.mutate({ id: c._id, kind: 'delete' })}><Trash2 className="h-4 w-4" /></Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
