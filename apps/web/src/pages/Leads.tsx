import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PhoneOutgoing, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input, Label, Select } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { initials, timeAgo } from '../lib/utils';
import { hasModule, useAuthStore } from '../store/auth';

interface LeadRow {
  _id: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  locale: string;
  status: string;
  source: string;
  score: number;
  firstResponseSeconds?: number;
  createdAt: string;
}

const statusTone: Record<string, 'green' | 'yellow' | 'pink' | 'purple' | 'blue' | 'neutral'> = {
  new: 'blue',
  contacted: 'yellow',
  qualified: 'green',
  appointment: 'purple',
  nurture: 'neutral',
  won: 'green',
  lost: 'pink',
  dnc: 'pink',
};

export default function Leads() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const account = useAuthStore((s) => s.account);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', locale: 'en', propertyInterest: '' });

  const leads = useQuery({
    queryKey: ['leads', search],
    queryFn: () => api<{ items: LeadRow[]; total: number }>(`/leads?search=${encodeURIComponent(search)}&limit=50`),
  });

  const addLead = useMutation({
    mutationFn: () =>
      api('/leads', {
        method: 'POST',
        body: { ...form, lastName: form.lastName || undefined, phone: form.phone || undefined, email: form.email || undefined, propertyInterest: form.propertyInterest || undefined },
      }),
    onSuccess: () => {
      setShowForm(false);
      setForm({ firstName: '', lastName: '', phone: '', email: '', locale: 'en', propertyInterest: '' });
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  const callLead = useMutation({
    mutationFn: (leadId: string) => api('/calls/trigger', { method: 'POST', body: { leadId, agentKey: 'speed-to-lead' } }),
  });

  if (leads.isLoading) return <PageSkeleton />;
  if (leads.isError) return <ErrorState onRetry={() => void leads.refetch()} />;
  const items = leads.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('leads.title')}
        subtitle={t('leads.subtitle')}
        action={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" /> {t('leads.addLead')}
          </Button>
        }
      />

      {showForm && (
        <Card tone="yellow">
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              addLead.mutate();
            }}
          >
            <div>
              <Label>First name</Label>
              <Input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input placeholder="+1305…" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label>Language</Label>
              <Select value={form.locale} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))}>
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="ar">العربية</option>
                <option value="pt">Português</option>
                <option value="ht">Kreyòl</option>
              </Select>
            </div>
            <div>
              <Label>Interest</Label>
              <Input value={form.propertyInterest} onChange={(e) => setForm((f) => ({ ...f, propertyInterest: e.target.value }))} />
            </div>
            <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={addLead.isPending}>
                {t('common.create')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </Button>
              {addLead.isError && <p className="text-sm text-ink">{t('common.error')} — phone or email required</p>}
            </div>
          </form>
        </Card>
      )}

      <Input placeholder={t('leads.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm bg-surface" />

      {items.length === 0 ? (
        <EmptyState icon={Users} title={t('leads.empty')} hint={t('leads.emptyHint')} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-start text-xs text-ink-soft">
                {['', t('leads.source'), t('leads.firstResponse'), t('leads.score'), '', ''].map((h, i) => (
                  <th key={i} className="px-6 py-4 text-start font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {items.map((lead) => (
                <tr key={lead._id} className="hover:bg-surface-2/50">
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-purple text-sm font-semibold">
                        {initials(lead.firstName, lead.lastName)}
                      </span>
                      <div>
                        <p className="font-medium">
                          {lead.firstName} {lead.lastName}
                        </p>
                        <p className="text-xs text-ink-soft" dir="ltr">{lead.phone ?? lead.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-3 capitalize text-ink-soft">{lead.source}</td>
                  <td className="px-6 py-3">
                    {lead.firstResponseSeconds !== undefined ? <Badge tone="yellow">⚡ {lead.firstResponseSeconds}s</Badge> : <span className="text-ink-soft">—</span>}
                  </td>
                  <td className="px-6 py-3 font-semibold">{lead.score}</td>
                  <td className="px-6 py-3">
                    <Badge tone={statusTone[lead.status] ?? 'neutral'} className="capitalize">
                      {t(`leads.status.${lead.status}`)}
                    </Badge>
                  </td>
                  <td className="px-6 py-3">
                    {hasModule(account, 'voice') && lead.phone && lead.status !== 'dnc' && (
                      <Button size="sm" variant="secondary" onClick={() => callLead.mutate(lead._id)} disabled={callLead.isPending} title={t('leads.callNow')}>
                        <PhoneOutgoing className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
