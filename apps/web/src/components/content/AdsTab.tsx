import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AD_CTAS, AD_OBJECTIVES, type AdCta, type AdObjective } from '@truecode/shared';
import { Megaphone, Pause, Play, RefreshCw, Rocket } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { Input, Label, Select, Textarea } from '../ui/input';
import { EmptyState, ErrorState } from '../ui/states';
import { api } from '../../lib/api';
import { CHART_COLORS, INK_SOFT, TOOLTIP_STYLE, type CampaignRow, type ProviderInfo } from './primitives';

type CampaignStatus = 'active' | 'paused' | 'completed';
type BadgeTone = 'green' | 'yellow' | 'pink' | 'purple' | 'blue' | 'neutral' | 'ink';

const humanize = (v: string): string =>
  v
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');

const STATUS_TONE: Record<string, BadgeTone> = {
  active: 'green',
  pending_review: 'yellow',
  paused: 'neutral',
  completed: 'blue',
  failed: 'pink',
  draft: 'neutral',
};

const splitList = (raw: string): string[] =>
  raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

export function AdsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  // ── Builder local state ─────────────────────────────────────────
  const [name, setName] = useState('');
  const [objective, setObjective] = useState<AdObjective>(AD_OBJECTIVES[0]);
  const [budgetDaily, setBudgetDaily] = useState(30);
  const [durationDays, setDurationDays] = useState(7);
  const [headline, setHeadline] = useState('');
  const [primaryText, setPrimaryText] = useState('');
  const [cta, setCta] = useState<AdCta>(AD_CTAS[0]);
  const [imageUrl, setImageUrl] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [cities, setCities] = useState('');
  const [radiusKm, setRadiusKm] = useState(25);
  const [country, setCountry] = useState('US');
  const [ageMin, setAgeMin] = useState(25);
  const [ageMax, setAgeMax] = useState(65);
  const [interests, setInterests] = useState('');

  const ads = useQuery({
    queryKey: ['content-ads'],
    queryFn: () => api<{ items: CampaignRow[]; provider: ProviderInfo }>('/content/ads'),
    refetchInterval: 8000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['content-ads'] });
    void qc.invalidateQueries({ queryKey: ['content-overview'] });
  };

  const launch = useMutation({
    mutationFn: () =>
      api('/content/ads', {
        method: 'POST',
        body: {
          name,
          objective,
          platform: 'meta' as const,
          budgetDaily,
          durationDays,
          creative: {
            headline,
            primaryText,
            cta,
            imageUrl: imageUrl.trim() || undefined,
            linkUrl: linkUrl.trim() || undefined,
          },
          targeting: {
            geo: { radiusKm, cities: splitList(cities), country },
            ageMin,
            ageMax,
            genders: ['all'] as ['all'],
            interests: splitList(interests),
          },
        },
      }),
    onSuccess: () => {
      setName('');
      setHeadline('');
      setPrimaryText('');
      invalidate();
    },
  });

  const sync = useMutation({
    mutationFn: (id: string) => api(`/content/ads/${id}/sync`, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CampaignStatus }) =>
      api(`/content/ads/${id}/status`, { method: 'POST', body: { status } }),
    onSuccess: invalidate,
  });

  const items = ads.data?.items ?? [];
  const provider = ads.data?.provider;

  // ── Summary strip ───────────────────────────────────────────────
  const totalSpend = items.reduce((s, c) => s + (c.metrics?.spend ?? 0), 0);
  const totalLeads = items.reduce((s, c) => s + (c.metrics?.leads ?? 0), 0);
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : 0;
  const activeCount = items.filter((c) => c.status === 'active').length;

  const canLaunch =
    !launch.isPending && name.trim().length > 0 && headline.trim().length > 0 && primaryText.trim().length > 0;

  const num = (v: string, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
      {/* ── Left: builder ──────────────────────────────────────── */}
      <div className="lg:col-span-2">
        <Card tone="purple">
          <div className="flex items-center gap-2">
            <Rocket className="h-5 w-5" />
            <CardTitle>{t('content.ads.builderTitle')}</CardTitle>
          </div>
          <CardDescription className="mt-1">{t('content.ads.housingNote')}</CardDescription>

          {provider && !provider.live && (
            <Badge tone="yellow" className="mt-3">
              {provider.reason ?? t('content.ads.mockNotice')}
            </Badge>
          )}

          <div className="mt-4 space-y-3">
            <div>
              <Label>{t('content.ads.name')}</Label>
              <Input
                placeholder={t('content.ads.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div>
              <Label>{t('content.ads.objective')}</Label>
              <Select value={objective} onChange={(e) => setObjective(e.target.value as AdObjective)}>
                {AD_OBJECTIVES.map((o) => (
                  <option key={o} value={o}>
                    {humanize(o)}
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('content.ads.budgetDaily')}</Label>
                <Input
                  type="number"
                  min={1}
                  value={budgetDaily}
                  onChange={(e) => setBudgetDaily(num(e.target.value, 0))}
                />
              </div>
              <div>
                <Label>{t('content.ads.durationDays')}</Label>
                <Input
                  type="number"
                  min={1}
                  value={durationDays}
                  onChange={(e) => setDurationDays(num(e.target.value, 0))}
                />
              </div>
            </div>

            {/* Creative */}
            <div className="pt-1">
              <Label>{t('content.ads.headline')}</Label>
              <Input
                placeholder={t('content.ads.headlinePlaceholder')}
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </div>
            <div>
              <Label>{t('content.ads.primaryText')}</Label>
              <Textarea
                placeholder={t('content.ads.primaryTextPlaceholder')}
                value={primaryText}
                onChange={(e) => setPrimaryText(e.target.value)}
              />
            </div>
            <div>
              <Label>{t('content.ads.cta')}</Label>
              <Select value={cta} onChange={(e) => setCta(e.target.value as AdCta)}>
                {AD_CTAS.map((c) => (
                  <option key={c} value={c}>
                    {humanize(c)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3">
              <div>
                <Label>{t('content.ads.imageUrl')}</Label>
                <Input
                  placeholder={t('content.ads.optional')}
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                />
              </div>
              <div>
                <Label>{t('content.ads.linkUrl')}</Label>
                <Input
                  placeholder={t('content.ads.optional')}
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                />
              </div>
            </div>

            {/* Targeting */}
            <div className="pt-1">
              <Label>{t('content.ads.cities')}</Label>
              <Input
                placeholder={t('content.ads.citiesPlaceholder')}
                value={cities}
                onChange={(e) => setCities(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('content.ads.radiusKm')}</Label>
                <Input
                  type="number"
                  min={1}
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(num(e.target.value, 0))}
                />
              </div>
              <div>
                <Label>{t('content.ads.country')}</Label>
                <Input value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('content.ads.ageMin')}</Label>
                <Input
                  type="number"
                  min={13}
                  value={ageMin}
                  onChange={(e) => setAgeMin(num(e.target.value, 0))}
                />
              </div>
              <div>
                <Label>{t('content.ads.ageMax')}</Label>
                <Input
                  type="number"
                  min={13}
                  value={ageMax}
                  onChange={(e) => setAgeMax(num(e.target.value, 0))}
                />
              </div>
            </div>
            <div>
              <Label>{t('content.ads.interests')}</Label>
              <Input
                placeholder={t('content.ads.interestsPlaceholder')}
                value={interests}
                onChange={(e) => setInterests(e.target.value)}
              />
            </div>

            <Button className="mt-2 w-full" onClick={() => canLaunch && launch.mutate()} disabled={!canLaunch}>
              <Rocket className="h-4 w-4" />
              {launch.isPending ? t('content.ads.launching') : t('content.ads.launch')}
            </Button>
          </div>
        </Card>
      </div>

      {/* ── Right: board ───────────────────────────────────────── */}
      <div className="space-y-5 lg:col-span-3">
        {ads.isLoading ? (
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <Card key={i} className="animate-pulse">
                <div className="h-5 w-40 rounded-full bg-surface-2" />
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {[0, 1, 2, 3, 4, 5].map((j) => (
                    <div key={j} className="h-16 rounded-2xl bg-surface-2" />
                  ))}
                </div>
              </Card>
            ))}
          </div>
        ) : ads.isError ? (
          <ErrorState onRetry={() => void ads.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title={t('content.ads.emptyTitle')}
            hint={t('content.ads.emptyHint')}
          />
        ) : (
          <>
            {/* Summary strip */}
            <div className="flex flex-wrap gap-2">
              <StatPill label={t('content.ads.totalSpend')} value={`$${totalSpend.toLocaleString()}`} />
              <StatPill label={t('content.ads.totalLeads')} value={totalLeads.toLocaleString()} />
              <StatPill label={t('content.ads.avgCpl')} value={`$${avgCpl.toFixed(2)}`} />
              <StatPill label={t('content.ads.active')} value={String(activeCount)} />
            </div>

            {items.map((c) => (
              <CampaignCard
                key={c._id}
                campaign={c}
                onSync={() => sync.mutate(c._id)}
                onStatus={(status) => setStatus.mutate({ id: c._id, status })}
                syncing={sync.isPending && sync.variables === c._id}
                statusing={setStatus.isPending && setStatus.variables?.id === c._id}
                t={t}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────
function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-4 py-2">
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 px-3 py-2 text-center">
      <p className="text-sm font-semibold text-ink">{value}</p>
      <p className="text-[11px] text-ink-soft">{label}</p>
    </div>
  );
}

function CampaignCard({
  campaign: c,
  onSync,
  onStatus,
  syncing,
  statusing,
  t,
}: {
  campaign: CampaignRow;
  onSync: () => void;
  onStatus: (status: CampaignStatus) => void;
  syncing: boolean;
  statusing: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const m = c.metrics;
  const tone = STATUS_TONE[c.status] ?? 'neutral';
  const paused = c.status === 'paused';
  const daily = m?.daily ?? [];

  const geo = (c.targeting?.geo ?? {}) as { radiusKm?: number; cities?: string[]; country?: string };
  const cityLabel = geo.cities && geo.cities.length > 0 ? geo.cities.join(', ') : geo.country ?? '';

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="truncate">{c.name}</CardTitle>
            <Badge tone={tone}>{humanize(c.status)}</Badge>
            {c.stub && <Badge tone="yellow">{t('content.ads.sample')}</Badge>}
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            {humanize(c.objective)} · {t('content.ads.perDay', { amount: c.budgetDaily, currency: c.currency })}
            {cityLabel ? ` · ${cityLabel} · ${geo.radiusKm ?? '?'}km` : ''}
          </p>
        </div>
      </div>

      {c.error && <p className="mt-2 text-xs text-card-pink">{c.error}</p>}

      {/* Metric tiles */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <MetricTile label={t('content.ads.impressions')} value={(m?.impressions ?? 0).toLocaleString()} />
        <MetricTile label={t('content.ads.clicks')} value={(m?.clicks ?? 0).toLocaleString()} />
        <MetricTile label={t('content.ads.ctr')} value={`${(m?.ctr ?? 0).toFixed(2)}%`} />
        <MetricTile label={t('content.ads.spend')} value={`$${(m?.spend ?? 0).toLocaleString()}`} />
        <MetricTile label={t('content.ads.leads')} value={(m?.leads ?? 0).toLocaleString()} />
        <MetricTile label={t('content.ads.cpl')} value={`$${(m?.cpl ?? 0).toFixed(2)}`} />
      </div>

      {/* Daily charts */}
      {daily.length > 0 && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs text-ink-soft">{t('content.ads.spend')}</p>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <defs>
                  <linearGradient id={`spend-${c._id}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS[1]} stopOpacity={0.9} />
                    <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.15} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" axisLine={false} tickLine={false} stroke={INK_SOFT} fontSize={12} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Area
                  type="monotone"
                  dataKey="spend"
                  stroke={CHART_COLORS[1]}
                  fill={`url(#spend-${c._id})`}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className="mb-1 text-xs text-ink-soft">{t('content.ads.leads')}</p>
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={daily} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="date" axisLine={false} tickLine={false} stroke={INK_SOFT} fontSize={12} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
                <Bar dataKey="leads" radius={[8, 8, 0, 0]}>
                  {daily.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[2]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} /> {t('content.ads.sync')}
        </Button>
        {c.status !== 'completed' && c.status !== 'failed' && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onStatus(paused ? 'active' : 'paused')}
            disabled={statusing}
          >
            {paused ? (
              <>
                <Play className="h-4 w-4" /> {t('content.ads.resume')}
              </>
            ) : (
              <>
                <Pause className="h-4 w-4" /> {t('content.ads.pause')}
              </>
            )}
          </Button>
        )}
      </div>
    </Card>
  );
}
