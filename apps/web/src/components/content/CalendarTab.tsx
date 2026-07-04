import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLATFORM_META, SOCIAL_PLATFORMS, type SocialPlatform } from '@truecode/shared';
import { CalendarDays, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { EmptyState, ErrorState } from '../ui/states';
import { api } from '../../lib/api';
import {
  CHART_COLORS,
  INK_SOFT,
  PlatformDot,
  TOOLTIP_STYLE,
  type Overview,
  type PostRow,
  type ProviderInfo,
} from './primitives';

type BadgeTone = 'green' | 'yellow' | 'pink' | 'purple' | 'blue' | 'neutral' | 'ink';

interface CalendarResponse {
  items: PostRow[];
  provider: { instagram: ProviderInfo; facebook: ProviderInfo; youtube: ProviderInfo };
}

const KNOWN_PLATFORMS = new Set<string>(SOCIAL_PLATFORMS);

/** Narrow arbitrary platform strings to the typed SocialPlatform set. */
function safePlatforms(platforms?: string[]): SocialPlatform[] {
  const list = (platforms ?? []).filter((p): p is SocialPlatform => KNOWN_PLATFORMS.has(p));
  return list.length ? list : ['instagram'];
}

function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'published':
    case 'stub-published':
      return 'green';
    case 'scheduled':
      return 'purple';
    case 'publishing':
    case 'partial':
      return 'yellow';
    case 'failed':
      return 'pink';
    default:
      return 'neutral';
  }
}

/** Upcoming = actively pending AND still in the future. */
function isUpcoming(post: PostRow): boolean {
  const pending = post.status === 'scheduled' || post.status === 'draft' || post.status === 'publishing';
  return pending && new Date(post.scheduledAt).getTime() > Date.now();
}

/** Convert an ISO string into a value the datetime-local input accepts. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function CalendarTab({ overview }: { overview: Overview }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const calendar = useQuery({
    queryKey: ['content-calendar'],
    queryFn: () => api<CalendarResponse>('/content/calendar'),
    refetchInterval: 8000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['content-calendar'] });
    void qc.invalidateQueries({ queryKey: ['content-overview'] });
  };

  const reschedule = useMutation({
    mutationFn: (vars: { id: string; scheduledAt: string }) =>
      api(`/content/posts/${vars.id}`, {
        method: 'PATCH',
        body: { scheduledAt: vars.scheduledAt, status: 'scheduled' },
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/content/posts/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const providers = calendar.data?.provider;
  const anyLive = Boolean(providers?.instagram.live || providers?.facebook.live || providers?.youtube.live);

  const { upcoming, past } = useMemo(() => {
    const items = [...(calendar.data?.items ?? [])];
    const up = items
      .filter(isUpcoming)
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    const rest = items
      .filter((p) => !isUpcoming(p))
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());
    return { upcoming: up, past: rest };
  }, [calendar.data]);

  const totalPosts = (calendar.data?.items ?? []).length;

  return (
    <div className="space-y-5">
      {/* ── Charts row ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        <Card tone="blue" className="lg:col-span-3">
          <CardTitle>{t('content.calendar.cadence')}</CardTitle>
          <CardDescription className="mb-3">{t('content.calendar.cadenceHint')}</CardDescription>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={overview.cadence}>
              <XAxis dataKey="day" axisLine={false} tickLine={false} fontSize={12} stroke={INK_SOFT} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="posts" radius={[10, 10, 10, 10]}>
                {overview.cadence.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card tone="purple" className="lg:col-span-2">
          <CardTitle>{t('content.calendar.mix')}</CardTitle>
          <CardDescription className="mb-3">{t('content.calendar.mixHint')}</CardDescription>
          {overview.mix.length === 0 ? (
            <p className="py-14 text-center text-sm text-ink-soft">{t('content.calendar.mixEmpty')}</p>
          ) : (
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <ResponsiveContainer width="100%" height={240} className="max-w-[220px]">
                <PieChart>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Pie
                    data={overview.mix}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={45}
                    outerRadius={70}
                    paddingAngle={3}
                    strokeWidth={0}
                  >
                    {overview.mix.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <ul className="w-full space-y-2">
                {overview.mix.map((m, i) => (
                  <li key={m.platform} className="flex items-center gap-2 text-sm">
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full"
                      style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                    <span className="flex-1 truncate text-ink">{m.label}</span>
                    <span className="font-semibold text-ink">{m.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* ── Calendar list ───────────────────────────────────────── */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>{t('content.calendar.title')}</CardTitle>
            <CardDescription>{t('content.calendar.subtitle')}</CardDescription>
          </div>
          {!calendar.isLoading && !anyLive && (
            <Badge tone="yellow">{t('content.calendar.needsConnection')}</Badge>
          )}
        </div>

        {calendar.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-black/[0.06]" />
            ))}
          </div>
        ) : calendar.isError ? (
          <ErrorState onRetry={() => void calendar.refetch()} />
        ) : totalPosts === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title={t('content.calendar.emptyTitle')}
            hint={t('content.calendar.emptyHint')}
          />
        ) : (
          <div className="space-y-6">
            {upcoming.length > 0 && (
              <PostGroup
                heading={t('content.calendar.upcoming')}
                posts={upcoming}
                onReschedule={(id, scheduledAt) => reschedule.mutate({ id, scheduledAt })}
                onDelete={(id) => remove.mutate(id)}
                busy={reschedule.isPending || remove.isPending}
                t={t}
              />
            )}
            {past.length > 0 && (
              <PostGroup
                heading={t('content.calendar.pastPublished')}
                posts={past}
                onReschedule={(id, scheduledAt) => reschedule.mutate({ id, scheduledAt })}
                onDelete={(id) => remove.mutate(id)}
                busy={reschedule.isPending || remove.isPending}
                t={t}
              />
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Post group ─────────────────────────────────────────────────────────────
function PostGroup({
  heading,
  posts,
  onReschedule,
  onDelete,
  busy,
  t,
}: {
  heading: string;
  posts: PostRow[];
  onReschedule: (id: string, scheduledAt: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
  t: (key: string) => string;
}) {
  return (
    <section>
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">{heading}</h4>
      <ul className="space-y-3">
        {posts.map((post) => (
          <PostCard
            key={post._id}
            post={post}
            onReschedule={onReschedule}
            onDelete={onDelete}
            busy={busy}
            t={t}
          />
        ))}
      </ul>
    </section>
  );
}

// ── Single post row ────────────────────────────────────────────────────────
function PostCard({
  post,
  onReschedule,
  onDelete,
  busy,
  t,
}: {
  post: PostRow;
  onReschedule: (id: string, scheduledAt: string) => void;
  onDelete: (id: string) => void;
  busy: boolean;
  t: (key: string) => string;
}) {
  const [when, setWhen] = useState(() => toLocalInput(post.scheduledAt));
  const platforms = safePlatforms(post.platforms);
  const thumb = post.mediaUrl ?? post.mediaUrls?.[0] ?? null;

  const submitReschedule = () => {
    if (!when) return;
    const iso = new Date(when).toISOString();
    if (!Number.isNaN(new Date(iso).getTime())) onReschedule(post._id, iso);
  };

  return (
    <li className="rounded-2xl bg-surface-2 p-4">
      <div className="flex items-start gap-3">
        {/* Thumbnail */}
        {thumb ? (
          <img
            src={thumb}
            alt=""
            className="h-12 w-12 shrink-0 rounded-xl object-cover"
          />
        ) : (
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-card-purple text-ink-soft">
            <CalendarDays className="h-5 w-5" />
          </div>
        )}

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex -space-x-1">
              {platforms.map((p) => (
                <PlatformDot key={p} platform={p} size="sm" />
              ))}
            </div>
            <Badge tone={statusTone(post.status)}>{t(`content.calendar.status.${post.status}`)}</Badge>
            <span className="text-xs text-ink-soft">{new Date(post.scheduledAt).toLocaleString()}</span>
          </div>

          <p className="mt-2 line-clamp-2 text-sm text-ink">{post.caption || t('content.calendar.noCaption')}</p>

          {/* Per-platform results summary */}
          {post.results && post.results.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {post.results.map((r, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-pill bg-surface px-2 py-0.5 text-[11px] text-ink-soft"
                  title={r.error ?? r.permalink ?? r.status}
                >
                  {PLATFORM_META[r.platform as SocialPlatform]?.label ?? r.platform}: {r.status}
                </span>
              ))}
            </div>
          )}

          {/* Reschedule + delete controls */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              type="datetime-local"
              className="w-auto"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <Button variant="secondary" size="sm" onClick={submitReschedule} disabled={busy || !when}>
              {t('content.calendar.reschedule')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDelete(post._id)} disabled={busy}>
              <Trash2 className="h-4 w-4" /> {t('content.calendar.delete')}
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}
