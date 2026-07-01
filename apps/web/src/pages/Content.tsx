import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Clapperboard, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { Input, Label, Textarea } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { hasModule, useAuthStore } from '../store/auth';

interface PostRow {
  _id: string;
  caption: string;
  type: string;
  scheduledAt: string;
  status: string;
}

interface VideoRow {
  _id: string;
  title: string;
  status: string;
  renderUrl?: string;
  stub: boolean;
}

export default function Content() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const account = useAuthStore((s) => s.account);
  const igEnabled = hasModule(account, 'instagram');

  const [topic, setTopic] = useState('');
  const [captions, setCaptions] = useState<string[]>([]);
  const [scheduleCaption, setScheduleCaption] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoScript, setVideoScript] = useState('');

  const posts = useQuery({
    queryKey: ['content-posts'],
    queryFn: () => api<{ items: PostRow[]; provider: { live: boolean; reason?: string } }>('/content/posts'),
    enabled: igEnabled,
    refetchInterval: 6000,
  });
  const videos = useQuery({
    queryKey: ['videos'],
    queryFn: () => api<{ items: VideoRow[]; provider: { live: boolean } }>('/content/videos'),
    refetchInterval: 6000,
  });

  const generate = useMutation({
    mutationFn: () => api<{ captions: string[] }>('/content/captions', { method: 'POST', body: { topic, count: 3 } }),
    onSuccess: (d) => setCaptions(d.captions),
  });

  const schedule = useMutation({
    mutationFn: () =>
      api('/content/posts', {
        method: 'POST',
        body: { caption: scheduleCaption, scheduledAt: new Date(scheduleAt || Date.now() + 3600_000).toISOString() },
      }),
    onSuccess: () => {
      setScheduleCaption('');
      void qc.invalidateQueries({ queryKey: ['content-posts'] });
    },
  });

  const requestVideo = useMutation({
    mutationFn: () => api('/content/videos', { method: 'POST', body: { title: videoTitle, script: videoScript } }),
    onSuccess: () => {
      setVideoTitle('');
      setVideoScript('');
      void qc.invalidateQueries({ queryKey: ['videos'] });
    },
  });

  if (igEnabled && posts.isLoading) return <PageSkeleton />;
  if (posts.isError || videos.isError) return <ErrorState onRetry={() => void posts.refetch()} />;

  return (
    <div className="space-y-6">
      <PageHeader title={t('content.title')} subtitle={t('content.subtitle')} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* AI captions — live */}
        <Card tone="purple">
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <CardTitle>{t('content.generate')}</CardTitle>
          </div>
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (topic.trim()) generate.mutate();
            }}
          >
            <Input required placeholder={t('content.topic')} value={topic} onChange={(e) => setTopic(e.target.value)} />
            <Button type="submit" disabled={generate.isPending}>
              {generate.isPending ? '…' : '✨'}
            </Button>
          </form>
          <div className="mt-4 space-y-3">
            {captions.map((c, i) => (
              <button
                key={i}
                onClick={() => setScheduleCaption(c)}
                className="block w-full rounded-2xl bg-surface p-4 text-start text-sm shadow-soft transition-transform hover:scale-[1.01]"
              >
                {c}
              </button>
            ))}
          </div>
        </Card>

        {/* Scheduler — UI live, publish stubbed pending Meta review */}
        <Card>
          <div className="mb-1 flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            <CardTitle>{t('content.schedule')}</CardTitle>
          </div>
          {igEnabled && posts.data && !posts.data.provider.live && (
            <CardDescription className="mb-4">
              <Badge tone="yellow">[STUB]</Badge> {t('content.pendingReview')}
            </CardDescription>
          )}
          {igEnabled ? (
            <>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (scheduleCaption.trim()) schedule.mutate();
                }}
              >
                <Textarea required placeholder="Caption…" value={scheduleCaption} onChange={(e) => setScheduleCaption(e.target.value)} />
                <div className="flex gap-3">
                  <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} />
                  <Button type="submit" disabled={schedule.isPending}>
                    {t('content.schedule')}
                  </Button>
                </div>
              </form>
              <div className="mt-5">
                <p className="mb-2 text-sm font-medium">{t('content.calendar')}</p>
                <ul className="space-y-2">
                  {(posts.data?.items ?? []).map((p) => (
                    <li key={p._id} className="flex items-center gap-3 rounded-2xl bg-surface-2 px-4 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{p.caption}</span>
                      <span className="text-xs text-ink-soft">{new Date(p.scheduledAt).toLocaleString()}</span>
                      <Badge tone={p.status === 'published' ? 'green' : p.status === 'stub-published' ? 'yellow' : 'neutral'}>
                        {p.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="py-8 text-sm text-ink-soft">{t('common.lockedHint')}</p>
          )}
        </Card>
      </div>

      {/* Video requests — queue live, render adapter stubbed */}
      <Card tone="yellow">
        <div className="mb-4 flex items-center gap-2">
          <Clapperboard className="h-5 w-5" />
          <CardTitle>{t('content.video')}</CardTitle>
          {videos.data && !videos.data.provider.live && <Badge tone="neutral">[STUB] render adapter</Badge>}
        </div>
        <form
          className="grid gap-3 sm:grid-cols-[240px,1fr,auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (videoTitle.trim() && videoScript.trim()) requestVideo.mutate();
          }}
        >
          <div>
            <Label>Title</Label>
            <Input required value={videoTitle} onChange={(e) => setVideoTitle(e.target.value)} />
          </div>
          <div>
            <Label>Script</Label>
            <Input required value={videoScript} onChange={(e) => setVideoScript(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={requestVideo.isPending}>
              {t('common.create')}
            </Button>
          </div>
        </form>
        <ul className="mt-4 space-y-2">
          {(videos.data?.items ?? []).map((v) => (
            <li key={v._id} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">{v.title}</span>
              {v.renderUrl && (
                <a href={v.renderUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                  {v.stub ? '[stub render]' : 'render'}
                </a>
              )}
              <Badge tone={v.status === 'done' ? 'green' : v.status === 'error' ? 'pink' : 'yellow'}>{v.status}</Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
