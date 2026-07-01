import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Radar } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { timeAgo } from '../lib/utils';

interface JobRow {
  _id: string;
  source: string;
  query: string;
  status: string;
  found: number;
  imported: number;
  createdAt: string;
}

export default function LeadEngine() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [source, setSource] = useState('google-maps');
  const [query, setQuery] = useState('');

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
    mutationFn: () => api('/lead-engine/jobs', { method: 'POST', body: { source, query, maxResults: 25 } }),
    onSuccess: () => {
      setQuery('');
      void qc.invalidateQueries({ queryKey: ['scrape-jobs'] });
    },
  });

  if (jobs.isLoading) return <PageSkeleton />;
  if (jobs.isError) return <ErrorState onRetry={() => void jobs.refetch()} />;
  const items = jobs.data?.items ?? [];
  const chartData = items.slice(0, 8).reverse().map((j) => ({ name: j.query.slice(0, 12), found: j.found, imported: j.imported }));

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

      <Card tone="green">
        <form
          className="grid gap-4 sm:grid-cols-[200px,1fr,auto]"
          onSubmit={(e) => {
            e.preventDefault();
            if (query.trim()) create.mutate();
          }}
        >
          <div>
            <Label>Source</Label>
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="google-maps">Google Maps</option>
              <option value="zillow-fsbo">Zillow FSBO</option>
              <option value="expired">Expired listings</option>
              <option value="instagram">Instagram</option>
            </Select>
          </div>
          <div>
            <Label>Query</Label>
            <Input required placeholder="e.g. Coral Gables homeowners" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={create.isPending}>
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
              {items.map((j) => (
                <li key={j._id} className="flex items-center gap-3 py-3">
                  <Badge tone="blue">{j.source}</Badge>
                  <span className="min-w-0 flex-1 truncate">{j.query}</span>
                  <span className="text-xs text-ink-soft">
                    {j.found} {t('leadEngine.found')} · {j.imported} {t('leadEngine.imported')}
                  </span>
                  <Badge tone={j.status === 'done' ? 'green' : j.status === 'error' ? 'pink' : 'yellow'}>{j.status}</Badge>
                  <span className="text-xs text-ink-soft">{timeAgo(j.createdAt)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
