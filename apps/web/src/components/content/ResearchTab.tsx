import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AD_ANGLES, type AdAngle } from '@truecode/shared';
import { ExternalLink, Radar, Search, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Input, Label, Select } from '../ui/input';
import { PageSkeleton } from '../ui/skeleton';
import { EmptyState, ErrorState } from '../ui/states';
import { api } from '../../lib/api';
import {
  CHART_COLORS,
  INK_SOFT,
  TOOLTIP_STYLE,
  type CompetitorAdRow,
  type ProviderInfo,
  type ResearchRun,
} from './primitives';

// ── API shapes ───────────────────────────────────────────────────────────────
interface ResearchData {
  runs: ResearchRun[];
  watched: CompetitorAdRow[];
  provider: ProviderInfo;
}
interface RunResult {
  run: ResearchRun;
  items: CompetitorAdRow[];
  provider: ProviderInfo;
  stub: boolean;
}

type ResearchPlatform = 'facebook' | 'instagram' | 'all';
type ActiveStatus = 'active' | 'all';

/** Humanize an angle slug ("just-listed" → "just listed"). */
function humanizeAngle(angle: string): string {
  return angle.replace(/-/g, ' ');
}

export function ResearchTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('US');
  const [platform, setPlatform] = useState<ResearchPlatform>('all');
  const [count, setCount] = useState(20);
  const [activeStatus, setActiveStatus] = useState<ActiveStatus>('active');

  // Latest-run results held locally so they render immediately.
  const [items, setItems] = useState<CompetitorAdRow[]>([]);
  const [lastProvider, setLastProvider] = useState<ProviderInfo | null>(null);
  const [lastStub, setLastStub] = useState(false);

  const research = useQuery({
    queryKey: ['content-research'],
    queryFn: () => api<ResearchData>('/content/research'),
    refetchInterval: 12000,
  });

  const run = useMutation({
    mutationFn: () =>
      api<RunResult>('/content/research', {
        method: 'POST',
        body: {
          query: query.trim(),
          region: region.trim() || 'US',
          platform,
          count: Math.min(Math.max(count, 1), 50),
          activeStatus,
        },
      }),
    onSuccess: (d) => {
      setItems(d.items);
      setLastProvider(d.provider);
      setLastStub(d.stub);
      void qc.invalidateQueries({ queryKey: ['content-research'] });
    },
  });

  const watch = useMutation({
    mutationFn: (v: { id: string; watched: boolean }) =>
      api(`/content/research/ads/${v.id}/watch`, { method: 'POST', body: { watched: v.watched } }),
    onSuccess: (_d, v) => {
      setItems((cur) => cur.map((it) => (it._id === v.id ? { ...it, watched: v.watched } : it)));
      void qc.invalidateQueries({ queryKey: ['content-research'] });
      void qc.invalidateQueries({ queryKey: ['content-overview'] });
    },
  });

  // ── Derived insights from the latest run's items ────────────────────────────
  const angleData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const it of items) counts.set(it.angle, (counts.get(it.angle) ?? 0) + 1);
    const order = (a: AdAngle) => AD_ANGLES.indexOf(a);
    return [...counts.entries()]
      .map(([angle, value]) => ({ angle, count: value }))
      .sort((a, b) => b.count - a.count || order(a.angle as AdAngle) - order(b.angle as AdAngle));
  }, [items]);

  const avgDays = useMemo(
    () => (items.length ? Math.round(items.reduce((s, it) => s + it.daysRunning, 0) / items.length) : 0),
    [items],
  );
  const topAngle = angleData[0]?.angle;

  const provider = lastProvider ?? research.data?.provider ?? { name: '', live: false };
  const showSample = lastStub || !provider.live;
  const watched = research.data?.watched ?? [];
  const runs = research.data?.runs ?? [];
  const hasNothing = runs.length === 0 && items.length === 0;

  if (research.isLoading) return <PageSkeleton />;
  if (research.isError) return <ErrorState onRetry={() => void research.refetch()} />;

  return (
    <div className="space-y-5">
      {/* ── Search ─────────────────────────────────────────────────── */}
      <Card tone="blue">
        <div className="flex items-center gap-2">
          <Search className="h-5 w-5" />
          <CardTitle>{t('content.research.searchTitle')}</CardTitle>
        </div>
        <CardDescription className="mb-4">{t('content.research.searchHint')}</CardDescription>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2">
            <Label>{t('content.research.query')}</Label>
            <Input
              placeholder={t('content.research.queryPlaceholder')}
              value={query}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            />
          </div>
          <div>
            <Label>{t('content.research.region')}</Label>
            <Input
              value={region}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRegion(e.target.value)}
            />
          </div>
          <div>
            <Label>{t('content.research.platform')}</Label>
            <Select
              value={platform}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setPlatform(e.target.value as ResearchPlatform)
              }
            >
              <option value="all">{t('content.research.platformAll')}</option>
              <option value="facebook">{t('content.research.platformFacebook')}</option>
              <option value="instagram">{t('content.research.platformInstagram')}</option>
            </Select>
          </div>
          <div>
            <Label>{t('content.research.count')}</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={count}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setCount(Number(e.target.value) || 0)
              }
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="w-40">
            <Label>{t('content.research.status')}</Label>
            <Select
              value={activeStatus}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                setActiveStatus(e.target.value as ActiveStatus)
              }
            >
              <option value="active">{t('content.research.statusActive')}</option>
              <option value="all">{t('content.research.statusAll')}</option>
            </Select>
          </div>
          <Button
            className="grow sm:grow-0"
            onClick={() => query.trim() && run.mutate()}
            disabled={run.isPending || !query.trim()}
          >
            <Search className="h-4 w-4" />
            {run.isPending ? t('content.research.running') : t('content.research.run')}
          </Button>
          {showSample ? (
            <Badge tone="yellow">{t('content.research.sampleData')}</Badge>
          ) : (
            <Badge tone="green">{t('content.research.liveData')}</Badge>
          )}
        </div>
      </Card>

      {/* ── Insights ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>{t('content.research.angleBreakdown')}</CardTitle>
          {angleData.length > 0 ? (
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={angleData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <XAxis
                    dataKey="angle"
                    tickFormatter={humanizeAngle}
                    axisLine={false}
                    tickLine={false}
                    stroke={INK_SOFT}
                    fontSize={12}
                    interval={0}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    stroke={INK_SOFT}
                    fontSize={12}
                  />
                  <Tooltip
                    contentStyle={TOOLTIP_STYLE}
                    cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                    labelFormatter={(l: string) => humanizeAngle(l)}
                  />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                    {angleData.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-6 text-sm text-ink-soft">{t('content.research.angleEmpty')}</p>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1">
          <StatPill label={t('content.research.totalAds')} value={String(items.length)} tone="bg-card-purple" />
          <StatPill label={t('content.research.avgDays')} value={`${avgDays}d`} tone="bg-card-blue" />
          <StatPill
            label={t('content.research.topAngle')}
            value={topAngle ? humanizeAngle(topAngle) : '—'}
            tone="bg-card-green"
          />
        </div>
      </div>

      {/* ── Results / empty ────────────────────────────────────────── */}
      {hasNothing ? (
        <EmptyState
          icon={Radar}
          title={t('content.research.emptyTitle')}
          hint={t('content.research.emptyHint')}
        />
      ) : (
        items.length > 0 && (
          <div>
            <h3 className="mb-3 text-base font-semibold text-ink">{t('content.research.latestResults')}</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((ad) => (
                <AdCard
                  key={ad._id}
                  ad={ad}
                  onWatch={() => watch.mutate({ id: ad._id, watched: !ad.watched })}
                  watchLabel={t(ad.watched ? 'content.research.watching' : 'content.research.watch')}
                  viewLabel={t('content.research.viewInLibrary')}
                  runningLabel={(days: number) => t('content.research.daysRunning', { days })}
                />
              ))}
            </div>
          </div>
        )
      )}

      {/* ── Watchlist ──────────────────────────────────────────────── */}
      {watched.length > 0 && (
        <Card>
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 fill-current" />
            <CardTitle>{t('content.research.watchlist')}</CardTitle>
          </div>
          <ul className="mt-3 space-y-2">
            {watched.map((ad) => (
              <li
                key={ad._id}
                className="flex flex-wrap items-center gap-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-semibold">{ad.advertiser}</span>
                  <span className="text-ink-soft"> · {ad.headline}</span>
                </span>
                <Badge tone="purple">{humanizeAngle(ad.angle)}</Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => watch.mutate({ id: ad._id, watched: false })}
                >
                  {t('content.research.unwatch')}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Recent runs ────────────────────────────────────────────── */}
      {runs.length > 0 && (
        <Card>
          <CardTitle>{t('content.research.recentRuns')}</CardTitle>
          <ul className="mt-3 space-y-1.5">
            {runs.map((r) => (
              <li key={r._id} className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                <span className="text-ink">{r.query}</span>
                <span>· {r.region}</span>
                <span>· {t('content.research.adCount', { count: r.count })}</span>
                <span>· {new Date(r.createdAt).toLocaleDateString()}</span>
                {r.stub && <Badge tone="yellow">{t('content.research.sample')}</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────
function StatPill({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className={`rounded-2xl ${tone} px-4 py-3`}>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-0.5 truncate text-lg font-semibold capitalize text-ink">{value}</p>
    </div>
  );
}

function AdCard({
  ad,
  onWatch,
  watchLabel,
  viewLabel,
  runningLabel,
}: {
  ad: CompetitorAdRow;
  onWatch: () => void;
  watchLabel: string;
  viewLabel: string;
  runningLabel: (days: number) => string;
}) {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="relative">
        <img
          src={ad.thumbnailUrl}
          alt={ad.advertiser}
          className="h-40 w-full rounded-2xl object-cover"
          loading="lazy"
        />
        <Badge tone="ink" className="absolute left-2 top-2 capitalize">
          {ad.mediaType}
        </Badge>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-ink">{ad.advertiser}</span>
        <span className="shrink-0 text-xs capitalize text-ink-soft">{ad.platform}</span>
      </div>

      <div>
        <Badge tone="purple" className="capitalize">
          {humanizeAngle(ad.angle)}
        </Badge>
      </div>

      <p className="font-medium text-ink">{ad.headline}</p>
      <p className="line-clamp-3 text-sm text-ink-soft">{ad.primaryText}</p>

      <div className="mt-auto flex flex-wrap gap-1.5 pt-1 text-xs text-ink-soft">
        <span className="rounded-pill bg-surface-2 px-2 py-0.5">{runningLabel(ad.daysRunning)}</span>
        <span className="rounded-pill bg-surface-2 px-2 py-0.5">{ad.estimatedSpend}</span>
        <span className="rounded-pill bg-surface-2 px-2 py-0.5">{ad.impressionsRange}</span>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button
          variant={ad.watched ? 'pastel' : 'secondary'}
          size="sm"
          className="grow"
          onClick={onWatch}
        >
          <Star className={`h-4 w-4 ${ad.watched ? 'fill-current' : ''}`} />
          {watchLabel}
        </Button>
        <a
          href={ad.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-pill bg-surface-2 px-4 text-sm font-medium text-ink transition hover:bg-surface"
        >
          <ExternalLink className="h-4 w-4" />
          {viewLabel}
        </a>
      </div>
    </Card>
  );
}
