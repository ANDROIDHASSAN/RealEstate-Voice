import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ASPECT_RATIOS, type AspectRatio } from '@truecode/shared';
import { Film, Images, Link2, Sparkles, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Input, Label, Select, Textarea } from '../ui/input';
import { EmptyState, ErrorState } from '../ui/states';
import { AspectFrame, type MediaAssetRow, type ProviderInfo } from './primitives';

const IMAGE_STYLES = ['photoreal', 'lifestyle', 'editorial', 'minimal', 'luxury'] as const;
type ImageStyle = (typeof IMAGE_STYLES)[number];

interface VideoRow {
  _id: string;
  title: string;
  status: string;
  renderUrl?: string;
  stub: boolean;
}

interface MediaResponse {
  items: MediaAssetRow[];
  provider: ProviderInfo;
}
interface VideosResponse {
  items: VideoRow[];
  provider: ProviderInfo;
}

/** Nearest supported aspect ratio for pixel dimensions. */
function nearestAspect(width: number, height: number): AspectRatio {
  if (!width || !height) return '1:1';
  const ratio = width / height;
  const options: Array<[AspectRatio, number]> = [
    ['1:1', 1],
    ['4:5', 0.8],
    ['9:16', 0.5625],
    ['16:9', 16 / 9],
  ];
  let best: AspectRatio = '1:1';
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const [aspect, value] of options) {
    const delta = Math.abs(ratio - value);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = aspect;
    }
  }
  return best;
}

/** Coerce a stored aspect string into a value AspectFrame understands. */
function frameAspect(aspect: string): AspectRatio | 'other' {
  return (ASPECT_RATIOS as readonly string[]).includes(aspect) ? (aspect as AspectRatio) : 'other';
}

/** Read a File into its base64 body (without the data: prefix) + content type. */
function readFileAsBase64(file: File): Promise<{ dataUrl: string; dataBase64: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      const meta = comma >= 0 ? result.slice(0, comma) : '';
      const contentType = meta.slice(meta.indexOf(':') + 1, meta.indexOf(';')) || file.type;
      resolve({ dataUrl: result, dataBase64: comma >= 0 ? result.slice(comma + 1) : result, contentType });
    };
    reader.readAsDataURL(file);
  });
}

/** Natural dimensions of an image data URL. */
function imageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = dataUrl;
  });
}

interface UploadPayload {
  name: string;
  kind: 'image' | 'video';
  dataBase64: string;
  contentType: string;
  width?: number;
  height?: number;
  aspect?: AspectRatio;
  sizeBytes: number;
  source: 'upload';
}
interface UrlPayload {
  name: string;
  kind: 'image' | 'video';
  url: string;
  source: 'url';
  aspect?: AspectRatio;
  width?: number;
  height?: number;
}

export function MediaTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL import
  const [urlName, setUrlName] = useState('');
  const [urlValue, setUrlValue] = useState('');
  const [urlKind, setUrlKind] = useState<'image' | 'video'>('image');

  // AI image
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<AspectRatio>('1:1');
  const [style, setStyle] = useState<ImageStyle>('photoreal');

  // AI video
  const [videoTitle, setVideoTitle] = useState('');
  const [videoScript, setVideoScript] = useState('');

  const media = useQuery({
    queryKey: ['content-media'],
    queryFn: () => api<MediaResponse>('/content/media'),
  });
  const videos = useQuery({
    queryKey: ['content-videos'],
    queryFn: () => api<VideosResponse>('/content/videos'),
    refetchInterval: 6000,
  });

  const invalidateMedia = () => {
    void qc.invalidateQueries({ queryKey: ['content-media'] });
    void qc.invalidateQueries({ queryKey: ['content-overview'] });
  };

  const upload = useMutation({
    mutationFn: (body: UploadPayload | UrlPayload) => api<{ asset: MediaAssetRow }>('/content/media', { method: 'POST', body }),
    onSuccess: invalidateMedia,
  });

  const generateImage = useMutation({
    mutationFn: () =>
      api<{ asset: MediaAssetRow; stub: boolean }>('/content/generate-image', {
        method: 'POST',
        body: { prompt, aspect, style },
      }),
    onSuccess: () => {
      setPrompt('');
      invalidateMedia();
    },
  });

  const renderVideo = useMutation({
    mutationFn: () =>
      api<{ job: VideoRow }>('/content/videos', {
        method: 'POST',
        body: { title: videoTitle, script: videoScript },
      }),
    onSuccess: () => {
      setVideoTitle('');
      setVideoScript('');
      void qc.invalidateQueries({ queryKey: ['content-videos'] });
      void qc.invalidateQueries({ queryKey: ['content-overview'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/content/media/${id}`, { method: 'DELETE' }),
    onSuccess: invalidateMedia,
  });

  const onPickFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const kind: 'image' | 'video' = file.type.startsWith('video') ? 'video' : 'image';
    const { dataUrl, dataBase64, contentType } = await readFileAsBase64(file);
    let width: number | undefined;
    let height: number | undefined;
    let derivedAspect: AspectRatio | undefined;
    if (kind === 'image') {
      const dims = await imageDimensions(dataUrl);
      if (dims.width && dims.height) {
        width = dims.width;
        height = dims.height;
        derivedAspect = nearestAspect(dims.width, dims.height);
      }
    }
    upload.mutate({
      name: file.name,
      kind,
      dataBase64,
      contentType,
      width,
      height,
      aspect: derivedAspect,
      sizeBytes: file.size,
      source: 'upload',
    });
  };

  const addByUrl = () => {
    if (!urlName.trim() || !urlValue.trim()) return;
    upload.mutate(
      {
        name: urlName.trim(),
        kind: urlKind,
        url: urlValue.trim(),
        source: 'url',
      },
      {
        onSuccess: () => {
          setUrlName('');
          setUrlValue('');
        },
      },
    );
  };

  const provider = media.data?.provider;
  const items = media.data?.items ?? [];
  const videoJobs = videos.data?.items ?? [];

  const videoStatusTone = (status: string): 'green' | 'pink' | 'yellow' =>
    status === 'done' ? 'green' : status === 'error' ? 'pink' : 'yellow';

  return (
    <div className="space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={onPickFile}
      />

      {/* ── 1. Add media ─────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t('content.media.addTitle')}</CardTitle>
            <CardDescription>{t('content.media.addHint')}</CardDescription>
          </div>
          {provider && !provider.live && (
            <Badge tone="yellow">{provider.reason ?? t('content.media.mockStorage')}</Badge>
          )}
        </div>

        {/* Drop / upload zone */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className="mt-4 flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-black/10 bg-surface-2 py-10 text-center transition hover:border-accent/40 hover:bg-surface"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-card-purple">
            <Upload className="h-5 w-5 text-ink" />
          </span>
          <span className="text-sm font-medium text-ink">
            {upload.isPending ? t('content.media.uploading') : t('content.media.dropHint')}
          </span>
          <span className="pointer-events-none">
            <Button variant="secondary" size="sm">
              <Upload className="h-4 w-4" /> {t('content.media.uploadCta')}
            </Button>
          </span>
        </button>

        {/* Import by URL */}
        <div className="mt-4">
          <Label>{t('content.media.importUrl')}</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1.4fr_auto_auto]">
            <Input
              placeholder={t('content.media.namePlaceholder')}
              value={urlName}
              onChange={(e) => setUrlName(e.target.value)}
            />
            <Input
              placeholder={t('content.media.urlPlaceholder')}
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
            />
            <Select
              className="sm:w-32"
              value={urlKind}
              onChange={(e) => setUrlKind(e.target.value as 'image' | 'video')}
            >
              <option value="image">{t('content.media.kindImage')}</option>
              <option value="video">{t('content.media.kindVideo')}</option>
            </Select>
            <Button
              variant="secondary"
              onClick={addByUrl}
              disabled={upload.isPending || !urlName.trim() || !urlValue.trim()}
            >
              <Link2 className="h-4 w-4" /> {t('content.media.add')}
            </Button>
          </div>
        </div>
      </Card>

      {/* ── 2. AI Studio ─────────────────────────────────────────── */}
      <Card tone="purple">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <CardTitle>{t('content.media.aiTitle')}</CardTitle>
        </div>
        <CardDescription className="mb-3">{t('content.media.aiHint')}</CardDescription>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* AI image */}
          <div className="rounded-2xl bg-surface p-4">
            <Label>{t('content.media.imagePrompt')}</Label>
            <Input
              placeholder={t('content.media.imagePromptPlaceholder')}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <Label>{t('content.media.aspect')}</Label>
                <Select value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
                  {ASPECT_RATIOS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>{t('content.media.style')}</Label>
                <Select value={style} onChange={(e) => setStyle(e.target.value as ImageStyle)}>
                  {IMAGE_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {t(`content.media.styles.${s}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button
              className="mt-4 w-full"
              onClick={() => prompt.trim() && generateImage.mutate()}
              disabled={generateImage.isPending || prompt.trim().length < 2}
            >
              <Sparkles className="h-4 w-4" />
              {generateImage.isPending ? t('content.media.generating') : t('content.media.generateImage')}
            </Button>
          </div>

          {/* AI video */}
          <div className="rounded-2xl bg-surface p-4">
            <Label>{t('content.media.videoTitle')}</Label>
            <Input
              placeholder={t('content.media.videoTitlePlaceholder')}
              value={videoTitle}
              onChange={(e) => setVideoTitle(e.target.value)}
            />
            <Textarea
              className="mt-3 min-h-[80px]"
              placeholder={t('content.media.scriptPlaceholder')}
              value={videoScript}
              onChange={(e) => setVideoScript(e.target.value)}
            />
            <Button
              className="mt-4 w-full"
              onClick={() => videoTitle.trim() && videoScript.trim() && renderVideo.mutate()}
              disabled={renderVideo.isPending || !videoTitle.trim() || !videoScript.trim()}
            >
              <Film className="h-4 w-4" />
              {renderVideo.isPending ? t('content.media.rendering') : t('content.media.renderVideo')}
            </Button>

            {videoJobs.length > 0 && (
              <ul className="mt-4 space-y-2">
                {videoJobs.map((job) => (
                  <li
                    key={job._id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {job.title}
                      {job.stub && <span className="ml-1 text-xs text-ink-soft">{t('content.media.stubRender')}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {job.renderUrl && (
                        <a
                          href={job.renderUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-ink underline underline-offset-2"
                        >
                          {t('content.media.open')}
                        </a>
                      )}
                      <Badge tone={videoStatusTone(job.status)}>{job.status}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {/* ── 3. Library ───────────────────────────────────────────── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>{t('content.media.libraryTitle')}</CardTitle>
          {items.length > 0 && (
            <span className="text-xs text-ink-soft">{t('content.media.assetCount', { count: items.length })}</span>
          )}
        </div>

        {media.isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse rounded-card bg-surface-2" style={{ aspectRatio: '4 / 5' }} />
            ))}
          </div>
        ) : media.isError ? (
          <ErrorState onRetry={() => void media.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Images}
            title={t('content.media.emptyTitle')}
            hint={t('content.media.emptyHint')}
            action={
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-4 w-4" /> {t('content.media.uploadCta')}
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {items.map((asset) => (
              <Card key={asset._id} className="group p-3">
                <AspectFrame aspect={frameAspect(asset.aspect)}>
                  {asset.kind === 'image' ? (
                    <img
                      src={asset.thumbnailUrl ?? asset.url}
                      alt={asset.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-3xl">🎬</span>
                  )}
                </AspectFrame>

                <div className="mt-3 flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{asset.name}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={t('content.media.delete')}
                    onClick={() => remove.mutate(asset._id)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{t(`content.media.kind${asset.kind === 'video' ? 'Video' : 'Image'}`)}</Badge>
                  <Badge tone="blue">{asset.aspect}</Badge>
                  {asset.stub && <Badge tone="yellow">{t('content.media.sample')}</Badge>}
                </div>

                {asset.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {asset.tags.slice(0, 4).map((tag) => (
                      <span key={tag} className="rounded-pill bg-surface-2 px-2 py-0.5 text-[10px] text-ink-soft">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
