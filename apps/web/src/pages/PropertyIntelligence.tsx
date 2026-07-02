import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AnalysisReport } from '@truecode/shared';
import { Building2, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PropertyReport } from '../components/property/PropertyReport';
import { scoreColor } from '../components/property/ScoreRing';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api, ApiError } from '../lib/api';
import { cn } from '../lib/utils';

interface AnalysisRow {
  _id: string;
  label: string;
  city?: string;
  state?: string;
  investmentScore: number;
  grade?: string;
  recommendation?: string;
  riskLevel?: string;
  status: 'running' | 'done' | 'error';
  enriched?: boolean;
  createdAt: string;
}
interface AnalysisDoc extends AnalysisRow {
  report?: AnalysisReport;
  error?: string;
}

const DEFAULT_FORM = {
  address: '', city: '', state: 'FL', zip: '', propertyType: 'single-family',
  askingPrice: '', bedrooms: '3', bathrooms: '2', sqft: '', yearBuilt: '',
  estimatedRentMonthly: '', hoaMonthly: '', repairCost: '', arv: '',
};

const SAMPLE = {
  address: '742 Brickell Bay Dr', city: 'Miami', state: 'FL', zip: '33131', propertyType: 'condo',
  askingPrice: '525000', bedrooms: '2', bathrooms: '2', sqft: '1180', yearBuilt: '2016',
  estimatedRentMonthly: '3600', hoaMonthly: '650', repairCost: '', arv: '',
};

function num(v: string): number | undefined {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? undefined : n;
}

export default function PropertyIntelligence() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['property-analyses'],
    queryFn: () => api<{ items: AnalysisRow[] }>('/property-analysis'),
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((i) => i.status === 'running') ? 2500 : false,
  });

  const selected = useQuery({
    queryKey: ['property-analysis', selectedId],
    queryFn: () => api<{ analysis: AnalysisDoc }>(`/property-analysis/${selectedId}`),
    enabled: Boolean(selectedId),
    refetchInterval: (query) => (query.state.data?.analysis.status === 'running' ? 2000 : false),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ id: string }>('/property-analysis', { method: 'POST', body }),
    onSuccess: (res) => {
      setShowForm(false);
      setForm(DEFAULT_FORM);
      setSelectedId(res.id);
      void qc.invalidateQueries({ queryKey: ['property-analyses'] });
    },
    onError: (e) => setFormError(e instanceof ApiError ? t('propertyIntel.formError') : t('common.error')),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/property-analysis/${id}`, { method: 'DELETE' }),
    onSuccess: (_d, id) => {
      if (selectedId === id) setSelectedId(null);
      void qc.invalidateQueries({ queryKey: ['property-analyses'] });
    },
  });

  const submit = () => {
    setFormError(null);
    const body = {
      address: form.address.trim(), city: form.city.trim(), state: form.state.trim(), zip: form.zip.trim(),
      propertyType: form.propertyType,
      askingPrice: num(form.askingPrice), sqft: num(form.sqft),
      bedrooms: num(form.bedrooms) ?? 3, bathrooms: num(form.bathrooms) ?? 2,
      yearBuilt: num(form.yearBuilt),
      estimatedRentMonthly: num(form.estimatedRentMonthly), hoaMonthly: num(form.hoaMonthly),
      repairCost: num(form.repairCost), arv: num(form.arv),
    };
    if (!body.address || !body.city || !body.askingPrice || !body.sqft) {
      setFormError(t('propertyIntel.formRequired'));
      return;
    }
    create.mutate(body);
  };

  if (list.isLoading) return <PageSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  const items = list.data!.items;

  const field = (key: keyof typeof form, label: string, opts?: { type?: string; placeholder?: string }) => (
    <label className="block">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      <input
        type={opts?.type ?? 'text'}
        value={form[key]}
        placeholder={opts?.placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        className="mt-1 h-11 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10"
      />
    </label>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('propertyIntel.title')}
        subtitle={t('propertyIntel.subtitle')}
        action={
          <Button onClick={() => { setShowForm((s) => !s); setSelectedId(null); }}>
            {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {t('propertyIntel.newAnalysis')}
          </Button>
        }
      />

      {showForm && (
        <Card className="cf-step-in">
          <div className="mb-4 flex items-center justify-between">
            <CardTitle>{t('propertyIntel.analyzeProperty')}</CardTitle>
            <button onClick={() => setForm(SAMPLE)} className="text-xs font-medium text-ink-soft underline">{t('propertyIntel.useSample')}</button>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <div className="col-span-2">{field('address', t('propertyIntel.address'), { placeholder: '742 Brickell Bay Dr' })}</div>
            {field('city', t('propertyIntel.city'))}
            {field('state', t('propertyIntel.state'))}
            <label className="block">
              <span className="text-xs font-medium text-ink-soft">{t('propertyIntel.propertyType')}</span>
              <select value={form.propertyType} onChange={(e) => setForm((f) => ({ ...f, propertyType: e.target.value }))} className="mt-1 h-11 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10">
                {['single-family', 'condo', 'townhouse', 'multi-family', 'land'].map((p) => <option key={p} value={p}>{p.replace('-', ' ')}</option>)}
              </select>
            </label>
            {field('askingPrice', t('propertyIntel.askingPrice'), { type: 'number', placeholder: '525000' })}
            {field('sqft', t('propertyIntel.sqft'), { type: 'number', placeholder: '1180' })}
            {field('bedrooms', t('propertyIntel.beds'), { type: 'number' })}
            {field('bathrooms', t('propertyIntel.baths'), { type: 'number' })}
            {field('yearBuilt', t('propertyIntel.yearBuilt'), { type: 'number', placeholder: '2016' })}
            {field('estimatedRentMonthly', t('propertyIntel.rentOptional'), { type: 'number' })}
            {field('hoaMonthly', t('propertyIntel.hoaOptional'), { type: 'number' })}
            {field('repairCost', t('propertyIntel.repairOptional'), { type: 'number' })}
            {field('arv', t('propertyIntel.arvOptional'), { type: 'number' })}
          </div>
          {formError && <p className="mt-3 text-sm text-rose-500">{formError}</p>}
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={submit} disabled={create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} {t('propertyIntel.runAnalysis')}
            </Button>
            <span className="text-xs text-ink-soft">{t('propertyIntel.runHint')}</span>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[320px_1fr]">
        {/* Saved analyses list */}
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('propertyIntel.savedReports')} ({items.length})</p>
          {items.length === 0 && !showForm && (
            <Card tone="green" className="text-center">
              <p className="text-sm text-ink-soft">{t('propertyIntel.noReports')}</p>
              <Button className="mt-3" size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> {t('propertyIntel.newAnalysis')}</Button>
            </Card>
          )}
          {items.map((it) => (
            <button
              key={it._id}
              onClick={() => { setSelectedId(it._id); setShowForm(false); }}
              className={cn(
                'w-full rounded-card bg-surface p-4 text-left shadow-soft transition-all hover:brightness-[0.98]',
                selectedId === it._id && 'ring-2 ring-accent',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{it.label}</p>
                  <p className="text-xs text-ink-soft">{it.city}{it.state ? `, ${it.state}` : ''}</p>
                </div>
                {it.status === 'running' ? (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2"><Loader2 className="h-4 w-4 animate-spin text-ink-soft" /></span>
                ) : it.status === 'error' ? (
                  <Badge tone="pink">error</Badge>
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: scoreColor(it.investmentScore) }}>{it.investmentScore}</span>
                )}
              </div>
              {it.status === 'done' && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral">{it.grade}</Badge>
                  <Badge tone={it.recommendation === 'Strong Buy' || it.recommendation === 'Buy' ? 'green' : it.recommendation === 'Avoid' ? 'pink' : 'yellow'}>{it.recommendation}</Badge>
                  {it.riskLevel && <Badge tone={it.riskLevel === 'High' ? 'pink' : it.riskLevel === 'Medium' ? 'yellow' : 'green'}>{it.riskLevel} risk</Badge>}
                  {it.enriched && <Badge tone="purple">AI</Badge>}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[11px] text-ink-soft">{it.status === 'running' ? t('propertyIntel.analyzing') : ''}</span>
                <Trash2 className="h-3.5 w-3.5 text-ink-soft hover:text-rose-500" onClick={(e) => { e.stopPropagation(); remove.mutate(it._id); }} />
              </div>
            </button>
          ))}
        </div>

        {/* Selected report */}
        <div>
          {!selectedId && !showForm && (
            <EmptyState icon={Building2} title={t('propertyIntel.emptyTitle')} hint={t('propertyIntel.emptyHint')} action={<Button onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> {t('propertyIntel.newAnalysis')}</Button>} />
          )}
          {selectedId && selected.isLoading && <PageSkeleton />}
          {selectedId && selected.data?.analysis.status === 'running' && (
            <Card className="flex flex-col items-center py-20 text-center">
              <div className="cf-working mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-card-purple"><Sparkles className="h-7 w-7" /></div>
              <h3 className="text-lg font-semibold">{t('propertyIntel.crewWorking')}</h3>
              <p className="mt-2 max-w-sm text-sm text-ink-soft">{t('propertyIntel.crewWorkingHint')}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {['Comparable Sales', 'Rental Income', 'Neighborhood', 'Strategy', 'Market'].map((a, i) => (
                  <span key={a} className="cf-step-in rounded-pill bg-surface-2 px-3 py-1 text-xs" style={{ animationDelay: `${i * 120}ms` }}>{a} agent</span>
                ))}
              </div>
            </Card>
          )}
          {selectedId && selected.data?.analysis.status === 'error' && (
            <Card tone="pink" className="py-12 text-center"><p className="font-semibold">{t('propertyIntel.analysisFailed')}</p><p className="mt-1 text-sm text-ink-soft">{selected.data.analysis.error}</p></Card>
          )}
          {selectedId && selected.data?.analysis.status === 'done' && selected.data.analysis.report && (
            <PropertyReport id={selectedId} report={selected.data.analysis.report} />
          )}
        </div>
      </div>
    </div>
  );
}
