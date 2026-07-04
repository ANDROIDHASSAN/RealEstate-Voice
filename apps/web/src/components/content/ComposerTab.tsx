import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CONTENT_GOALS,
  CONTENT_TONES,
  FORMAT_SPECS,
  PLATFORM_META,
  POST_FORMATS,
  SOCIAL_PLATFORMS,
  type ContentGoal,
  type ContentTone,
  type GeneratedPost,
  type PostFormat,
  type SocialPlatform,
} from '@truecode/shared';
import { Clock, Hash, ImagePlus, Send, Sparkles, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Input, Label, Select, Textarea } from '../ui/input';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth';
import { AspectFrame, PlatformDot, type MediaAssetRow, type Overview } from './primitives';

export function ComposerTab({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const account = useAuthStore((s) => s.account);

  const [platforms, setPlatforms] = useState<SocialPlatform[]>(['instagram']);
  const [format, setFormat] = useState<PostFormat>('feed-square');
  const [topic, setTopic] = useState('');
  const [tone, setTone] = useState<ContentTone>('friendly');
  const [goal, setGoal] = useState<ContentGoal>('engagement');
  const [listingDetails, setListingDetails] = useState('');
  const [includeHashtags, setIncludeHashtags] = useState(true);
  const [caption, setCaption] = useState('');
  const [firstComment, setFirstComment] = useState('');
  const [title, setTitle] = useState('');
  const [mediaAssetIds, setMediaAssetIds] = useState<string[]>([]);
  const [mediaUrl, setMediaUrl] = useState('');
  const [scheduleAt, setScheduleAt] = useState('');
  const [publishNow, setPublishNow] = useState(false);
  const [variants, setVariants] = useState<GeneratedPost[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const media = useQuery({
    queryKey: ['content-media'],
    queryFn: () => api<{ items: MediaAssetRow[] }>('/content/media'),
  });

  const spec = FORMAT_SPECS[format];
  const previewPlatform = platforms[0] ?? 'instagram';
  const selectedMedia = useMemo(
    () => (media.data?.items ?? []).filter((m) => mediaAssetIds.includes(m._id)),
    [media.data, mediaAssetIds],
  );
  const previewMediaUrl = selectedMedia[0]?.url ?? (mediaUrl.trim() || null);

  const generate = useMutation({
    mutationFn: () =>
      api<{ posts: GeneratedPost[]; provider: { live: boolean } }>('/content/generate', {
        method: 'POST',
        body: {
          topic,
          platform: previewPlatform,
          format,
          tone,
          goal,
          locale: account?.locale ?? 'en',
          includeHashtags,
          listingDetails: listingDetails || undefined,
          variants: 3,
        },
      }),
    onSuccess: (d) => {
      setVariants(d.posts);
      if (!d.provider.live) setNotice(t('content.composer.mockNotice'));
    },
  });

  const publish = useMutation({
    mutationFn: () =>
      api('/content/compose', {
        method: 'POST',
        body: {
          platforms,
          format,
          title: title || undefined,
          caption,
          firstComment: firstComment || undefined,
          mediaAssetIds,
          mediaUrls: mediaUrl.trim() ? [mediaUrl.trim()] : [],
          publishNow,
          scheduledAt: publishNow ? undefined : new Date(scheduleAt || Date.now() + 3600_000).toISOString(),
        },
      }),
    onSuccess: () => {
      setNotice(publishNow ? t('content.composer.publishedNotice') : t('content.composer.scheduledNotice'));
      setCaption('');
      setFirstComment('');
      setVariants([]);
      void qc.invalidateQueries({ queryKey: ['content-calendar'] });
      void qc.invalidateQueries({ queryKey: ['content-overview'] });
    },
  });

  const applyVariant = (v: GeneratedPost) => {
    const tags = v.hashtags.length ? '\n\n' + v.hashtags.map((h) => `#${h}`).join(' ') : '';
    setCaption(`${v.hook ? v.hook + '\n\n' : ''}${v.caption}${tags}`.trim());
    setFirstComment(v.firstComment);
  };

  const togglePlatform = (p: SocialPlatform) =>
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const toggleAsset = (id: string) =>
    setMediaAssetIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const canPublish = caption.trim().length > 0 && platforms.length > 0 && !publish.isPending;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      {/* ── Left: build ─────────────────────────────────────────── */}
      <div className="space-y-5 lg:col-span-3">
        {notice && (
          <div className="flex items-center justify-between rounded-2xl bg-card-green px-4 py-3 text-sm">
            <span>{notice}</span>
            <button className="text-ink-soft hover:text-ink" onClick={() => setNotice(null)}>
              ✕
            </button>
          </div>
        )}

        {/* Platforms + format */}
        <Card tone="blue">
          <CardTitle>{t('content.composer.channels')}</CardTitle>
          <div className="mt-3 flex flex-wrap gap-2">
            {SOCIAL_PLATFORMS.map((p) => {
              const on = platforms.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => togglePlatform(p)}
                  className={`inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm font-medium transition ${
                    on ? 'bg-accent text-accent-on shadow-soft' : 'bg-surface text-ink-soft hover:bg-surface-2'
                  }`}
                >
                  <PlatformDot platform={p} size="sm" />
                  {PLATFORM_META[p].label}
                </button>
              );
            })}
          </div>
          <div className="mt-4">
            <Label>{t('content.composer.format')}</Label>
            <div className="flex flex-wrap gap-2">
              {POST_FORMATS.map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`rounded-pill px-3 py-1.5 text-xs font-medium transition ${
                    format === f ? 'bg-accent text-accent-on' : 'bg-surface-2 text-ink-soft hover:bg-surface'
                  }`}
                >
                  {FORMAT_SPECS[f].label} · {FORMAT_SPECS[f].aspect}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* AI generation */}
        <Card tone="purple">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" />
            <CardTitle>{t('content.composer.aiTitle')}</CardTitle>
          </div>
          <CardDescription className="mb-3">{t('content.composer.aiHint')}</CardDescription>
          <Input placeholder={t('content.composer.topic')} value={topic} onChange={(e) => setTopic(e.target.value)} />
          <Textarea
            className="mt-3"
            placeholder={t('content.composer.listing')}
            value={listingDetails}
            onChange={(e) => setListingDetails(e.target.value)}
          />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label>{t('content.composer.tone')}</Label>
              <Select value={tone} onChange={(e) => setTone(e.target.value as ContentTone)}>
                {CONTENT_TONES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{t('content.composer.goal')}</Label>
              <Select value={goal} onChange={(e) => setGoal(e.target.value as ContentGoal)}>
                {CONTENT_GOALS.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={includeHashtags} onChange={(e) => setIncludeHashtags(e.target.checked)} />
            <Hash className="h-4 w-4" /> {t('content.composer.hashtags')}
          </label>
          <Button className="mt-4 w-full" onClick={() => topic.trim() && generate.mutate()} disabled={generate.isPending || !topic.trim()}>
            <Sparkles className="h-4 w-4" /> {generate.isPending ? t('content.composer.generating') : t('content.composer.generate')}
          </Button>

          {variants.length > 0 && (
            <div className="mt-4 space-y-2">
              {variants.map((v, i) => (
                <button
                  key={i}
                  onClick={() => applyVariant(v)}
                  className="block w-full rounded-2xl bg-surface p-4 text-start text-sm shadow-soft transition-transform hover:scale-[1.01]"
                >
                  {v.hook && <p className="font-semibold">{v.hook}</p>}
                  <p className="mt-1 text-ink-soft">{v.caption}</p>
                  {v.hashtags.length > 0 && (
                    <p className="mt-2 text-xs text-ink-soft/80">{v.hashtags.map((h) => `#${h}`).join(' ')}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Caption + media + schedule */}
        <Card>
          <CardTitle>{t('content.composer.postTitle')}</CardTitle>
          {(previewPlatform === 'youtube' || format === 'landscape') && (
            <Input className="mt-3" placeholder={t('content.composer.videoTitle')} value={title} onChange={(e) => setTitle(e.target.value)} />
          )}
          <Textarea
            className="mt-3 min-h-[140px]"
            placeholder={t('content.composer.caption')}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
          <Input
            className="mt-3"
            placeholder={t('content.composer.firstComment')}
            value={firstComment}
            onChange={(e) => setFirstComment(e.target.value)}
          />

          {/* Media picker */}
          <div className="mt-4">
            <Label>{t('content.composer.media')}</Label>
            <div className="flex flex-wrap gap-2">
              {(media.data?.items ?? []).slice(0, 8).map((m) => (
                <button
                  key={m._id}
                  onClick={() => toggleAsset(m._id)}
                  className={`h-16 w-16 overflow-hidden rounded-xl border-2 ${
                    mediaAssetIds.includes(m._id) ? 'border-accent' : 'border-transparent'
                  }`}
                >
                  {m.kind === 'image' ? (
                    <img src={m.thumbnailUrl ?? m.url} alt={m.name} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center bg-surface-2 text-xs">🎬</span>
                  )}
                </button>
              ))}
              {!media.data?.items.length && (
                <span className="flex items-center gap-1 text-xs text-ink-soft">
                  <ImagePlus className="h-4 w-4" /> {t('content.composer.noMedia')}
                </span>
              )}
            </div>
            <Input
              className="mt-2"
              placeholder={t('content.composer.mediaUrl')}
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
            />
          </div>

          {/* Schedule */}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
              {t('content.composer.publishNow')}
            </label>
            {!publishNow && (
              <Input
                type="datetime-local"
                className="w-auto"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
              />
            )}
          </div>
          {!publishNow && overview.bestTimes.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
                <Clock className="h-3.5 w-3.5" /> {t('content.composer.bestTimes')}:
              </span>
              {overview.bestTimes.slice(0, 4).map((bt, i) => (
                <Badge key={i} tone="neutral">
                  {bt.label}
                </Badge>
              ))}
            </div>
          )}
          <Button className="mt-4 w-full" onClick={() => canPublish && publish.mutate()} disabled={!canPublish}>
            <Send className="h-4 w-4" />
            {publish.isPending
              ? '…'
              : publishNow
                ? t('content.composer.publishTo', { count: platforms.length })
                : t('content.composer.scheduleTo', { count: platforms.length })}
          </Button>
        </Card>
      </div>

      {/* ── Right: live preview ─────────────────────────────────── */}
      <div className="lg:col-span-2">
        <Card className="sticky top-4">
          <CardTitle>{t('content.composer.preview')}</CardTitle>
          <div className="mt-3 rounded-2xl bg-surface-2 p-3">
            <div className="mb-2 flex items-center gap-2">
              <PlatformDot platform={previewPlatform} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{account?.name ?? 'Your Realty'}</p>
                <p className="text-xs text-ink-soft">{PLATFORM_META[previewPlatform].label} · {spec.label}</p>
              </div>
            </div>
            <AspectFrame aspect={spec.aspect}>
              {previewMediaUrl ? (
                <img src={previewMediaUrl} alt="preview" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-card-purple to-card-blue text-ink-soft">
                  <ImagePlus className="h-8 w-8 opacity-50" />
                </div>
              )}
            </AspectFrame>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm">
              {caption || <span className="text-ink-soft">{t('content.composer.previewEmpty')}</span>}
            </p>
            {firstComment && <p className="mt-2 text-xs text-ink-soft">↳ {firstComment}</p>}
          </div>
          {platforms.length > 1 && (
            <p className="mt-3 text-xs text-ink-soft">
              {t('content.composer.crosspost', { platforms: platforms.map((p) => PLATFORM_META[p].label).join(', ') })}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
