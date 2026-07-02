import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Radar, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { buildPersonaQuery, LEAD_PERSONAS, SCRAPE_COUNTRIES, type LeadPersona } from '@closeflow/shared';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { cn, timeAgo } from '../lib/utils';

interface JobRow {
  _id: string;
  source: string;
  query: string;
  status: string;
  found: number;
  imported: number;
  personaKey?: string;
  city?: string;
  country?: string;
  createdAt: string;
}

export default function LeadEngine() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [persona, setPersona] = useState<LeadPersona | null>(null);
  const [source, setSource] = useState('google-maps');
  const [query, setQuery] = useState('');
  const [countryCode, setCountryCode] = useState('US');
  const [city, setCity] = useState('Miami');
  const [maxResults, setMaxResults] = useState(25);
  const [showFilters, setShowFilters] = useState(false);
  const [propertyType, setPropertyType] = useState('any');
  const [budgetBand, setBudgetBand] = useState('any');
  const [hasPhone, setHasPhone] = useState(false);
  const [hasEmail, setHasEmail] = useState(true);
  const [radiusKm, setRadiusKm] = useState(30);

  const country = SCRAPE_COUNTRIES.find((c) => c.code === countryCode) ?? SCRAPE_COUNTRIES[0]!;

  const status = useQuery({
    queryKey: ['le-status'],
    queryFn: () => api<{ provider: { name: string; live: boolean; reason?: string } }>('/lead-engine/status'),
  });
  const jobs = useQuery({
    queryKey: ['scrape-jobs'],
    queryFn: () => api<{ items: JobRow[] }>('/lead-engine/jobs'),
    refetchInterval: 4000,
  });

  const create = useMutation({
    mutationFn: () => {
      const finalQuery = persona ? buildPersonaQuery(persona.queryTemplate, city, country.name) : `${query} ${city}`.trim();
      return api('/lead-engine/jobs', {
        method: 'POST',
        body: {
          source: persona?.source ?? source,
          query: finalQuery,
          maxResults,
          country: country.name,
          city,
          personaKey: persona?.key,
          filters: {
            propertyType: propertyType as never,
            budgetBand: budgetBand as never,
            hasPhone,
            hasEmail,
            radiusKm,
          },
        },
      });
    },
    onSuccess: () => {
      setQuery('');
      void qc.invalidateQueries({ queryKey: ['scrape-jobs'] });
    },
  });

  const applyPersona = (p: LeadPersona) => {
    const next = persona?.key === p.key ? null : p;
    setPersona(next);
    if (next) {
      setSource(next.source);
      setMaxResults(next.suggestedMaxResults);
      if (next.filters.propertyType) setPropertyType(next.filters.propertyType);
      if (next.filters.budgetBand) setBudgetBand(next.filters.budgetBand);
      if (next.filters.hasPhone !== undefined) setHasPhone(next.filters.hasPhone);
      if (next.filters.hasEmail !== undefined) setHasEmail(next.filters.hasEmail);
      if (next.filters.radiusKm) setRadiusKm(next.filters.radiusKm);
    }
  };

  if (jobs.isLoading) return <PageSkeleton />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;
  const items = jobs.data?.items ?? [];
  const chartData = items.slice(0, 8).reverse().map((j) => ({ name: j.query.slice(0, 12), found: j.found, imported: j.imported }));
  const previewQuery = persona ? buildPersonaQuery(persona.queryTemplate, city, country.name) : `${query} ${city}`.trim();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('leadEngine.title')}
        subtitle={t('leadEngine.subtitle')}
        action={
          status.data && !status.data.provider.live ? (
            <Badge tone="yellow">⚠ {t('settings.needsKey')}: Apify — sample data</Badge>
          ) : undefined
        }
      />

      {/* Persona template gallery — the top real-estate prospect segments */}
      <Card tone="purple">
        <CardTitle className="mb-1">{t('leadEngine.personas')}</CardTitle>
        <CardDescription className="mb-4">{t('leadEngine.personasHint')}</CardDescription>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {LEAD_PERSONAS.map((p) => (
            <button
              key={p.key}
              onClick={() => applyPersona(p)}
              title={p.description}
              className={cn(
                'flex items-center gap-3 rounded-2xl px-4 py-3 text-start text-sm transition-all',
                persona?.key === p.key ? 'bg-accent text-accent-on shadow-soft' : 'bg-surface hover:bg-surface-2',
              )}
            >
              <span className="text-xl">{p.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className={cn('block truncate text-xs', persona?.key === p.key ? 'text-accent-on/70' : 'text-ink-soft')}>
                  {p.intent} · {p.source}
                </span>
              </span>
            </button>
          ))}
        </div>
        {persona && <p className="mt-3 text-sm text-ink-soft">{persona.description}</p>}
      </Card>

      {/* Job builder — location, query, filters */}
      <Card tone="green">
        <div className="mb-4 flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          <CardTitle>{t('leadEngine.where')}</CardTitle>
        </div>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (previewQuery.length >= 2) create.mutate();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label>{t('leadEngine.country')}</Label>
              <Select
                value={countryCode}
                onChange={(e) => {
                  setCountryCode(e.target.value);
                  const c = SCRAPE_COUNTRIES.find((x) => x.code === e.target.value);
                  if (c?.cities[0]) setCity(c.cities[0]);
                }}
              >
                {SCRAPE_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{t('leadEngine.city')}</Label>
              <Select value={city} onChange={(e) => setCity(e.target.value)}>
                {country.cities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={persona?.source ?? source} disabled={Boolean(persona)} onChange={(e) => setSource(e.target.value)}>
                <option value="google-maps">Google Maps</option>
                <option value="zillow-fsbo">Zillow FSBO</option>
                <option value="expired">Expired listings</option>
                <option value="instagram">Instagram</option>
              </Select>
            </div>
            <div>
              <Label>{t('leadEngine.maxResults')}</Label>
              <Input type="number" min={1} max={200} value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value) || 25)} />
            </div>
          </div>

          {!persona && (
            <div>
              <Label>{t('leadEngine.customQuery')}</Label>
              <Input placeholder={t('leadEngine.customQueryPh')} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-ink-soft hover:text-ink"
          >
            <SlidersHorizontal className="h-4 w-4" /> {t('leadEngine.filters')} {showFilters ? '▴' : '▾'}
          </button>

          {showFilters && (
            <div className="grid gap-4 rounded-2xl bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <Label>{t('leadEngine.propertyType')}</Label>
                <Select value={propertyType} onChange={(e) => setPropertyType(e.target.value)}>
                  <option value="any">{t('leadEngine.any')}</option>
                  <option value="residential">Residential</option>
                  <option value="condo">Condo</option>
                  <option value="luxury">Luxury</option>
                  <option value="commercial">Commercial</option>
                  <option value="land">Land</option>
                </Select>
              </div>
              <div>
                <Label>{t('leadEngine.budget')}</Label>
                <Select value={budgetBand} onChange={(e) => setBudgetBand(e.target.value)}>
                  <option value="any">{t('leadEngine.any')}</option>
                  <option value="entry">$ Entry</option>
                  <option value="mid">$$ Mid</option>
                  <option value="high">$$$ High</option>
                  <option value="ultra">$$$$ Ultra</option>
                </Select>
              </div>
              <div>
                <Label>{t('leadEngine.radius')} (km)</Label>
                <Input type="number" min={1} max={500} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value) || 30)} />
              </div>
              <label className="flex items-end gap-2 pb-3 text-sm">
                <input type="checkbox" checked={hasPhone} onChange={(e) => setHasPhone(e.target.checked)} className="h-4 w-4" />
                {t('leadEngine.needPhone')}
              </label>
              <label className="flex items-end gap-2 pb-3 text-sm">
                <input type="checkbox" checked={hasEmail} onChange={(e) => setHasEmail(e.target.checked)} className="h-4 w-4" />
                {t('leadEngine.needEmail')}
              </label>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-ink-soft">
              {t('leadEngine.willSearch')}: <span className="font-medium text-ink">“{previewQuery || '—'}”</span>
            </p>
            <Button type="submit" disabled={create.isPending || previewQuery.length < 2}>
              <Plus className="h-4 w-4" /> {t('leadEngine.newJob')}
            </Button>
          </div>
        </form>
      </Card>

      {items.length === 0 ? (
        <EmptyState icon={Radar} title={t('leadEngine.empty')} hint={t('leadEngine.emptyHint')} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardTitle className="mb-6">
              {t('leadEngine.found')} vs {t('leadEngine.imported')}
            </CardTitle>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={18}>
                <XAxis dataKey="name" axisLine={false} tickLine={false} fontSize={11} stroke="#6B6B6B" />
                <Tooltip cursor={{ fill: 'rgba(0,0,0,0.03)' }} contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} />
                <Bar dataKey="found" fill="#D9E7F7" radius={[8, 8, 8, 8]} />
                <Bar dataKey="imported" fill="#D2ECDB" radius={[8, 8, 8, 8]} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <CardTitle className="mb-4">Jobs</CardTitle>
            <ul className="divide-y divide-black/5 text-sm">
              {items.map((j) => {
                const jobPersona = LEAD_PERSONAS.find((p) => p.key === j.personaKey);
                return (
                  <li key={j._id} className="flex items-center gap-3 py-3">
                    <Badge tone="blue">{jobPersona ? `${jobPersona.emoji} ${jobPersona.name}` : j.source}</Badge>
                    <span className="min-w-0 flex-1 truncate" title={j.query}>
                      {j.query}
                      {j.city && <span className="text-ink-soft"> · {j.city}</span>}
                    </span>
                    <span className="text-xs text-ink-soft">
                      {j.found} {t('leadEngine.found')} · {j.imported} {t('leadEngine.imported')}
                    </span>
                    <Badge tone={j.status === 'done' ? 'green' : j.status === 'error' ? 'pink' : 'yellow'}>{j.status}</Badge>
                    <span className="text-xs text-ink-soft">{timeAgo(j.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
