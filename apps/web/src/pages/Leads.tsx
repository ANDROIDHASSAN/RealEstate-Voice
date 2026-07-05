import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Globe,
  MapPin,
  Pencil,
  PhoneOutgoing,
  Plus,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { Fragment, type ReactNode, useState } from 'react';
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

interface Scraped {
  businessName?: string;
  rating?: number;
  reviewsCount?: number;
  website?: string;
  category?: string;
  address?: string;
  googleMapsUrl?: string;
  sourceDetail?: string;
}

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
  intent?: string;
  urgency?: string;
  budget?: string;
  location?: string;
  propertyInterest?: string;
  firstResponseSeconds?: number;
  consent?: { sms?: boolean; call?: boolean; whatsapp?: boolean; email?: boolean };
  scraped?: Scraped;
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

const STATUSES = ['new', 'contacted', 'qualified', 'appointment', 'nurture', 'won', 'lost', 'dnc'];
const INTENTS = ['unknown', 'buyer', 'seller', 'renter', 'investor'];
const URGENCIES = ['unknown', 'now', '1-3mo', '3-6mo', '6mo+'];

type EditForm = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  location: string;
  propertyInterest: string;
  budget: string;
  status: string;
  intent: string;
  urgency: string;
};

export default function Leads() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const account = useAuthStore((s) => s.account);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', phone: '', email: '', locale: 'en', propertyInterest: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const leads = useQuery({
    queryKey: ['leads', search],
    queryFn: () => api<{ items: LeadRow[]; total: number }>(`/leads?search=${encodeURIComponent(search)}&limit=50`),
    refetchInterval: 4000,
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

  const saveEdit = useMutation({
    mutationFn: (vars: { id: string; body: Partial<EditForm> }) => api(`/leads/${vars.id}`, { method: 'PATCH', body: vars.body }),
    onSuccess: () => {
      setEditing(null);
      setEditForm(null);
      setNotice(t('leads.saved', 'Lead updated.'));
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  const removeLead = useMutation({
    mutationFn: (id: string) => api<{ ok?: boolean; pendingApproval?: boolean }>(`/leads/${id}`, { method: 'DELETE' }),
    onSuccess: (d) => {
      setNotice(d.pendingApproval ? t('leads.deleteQueued', 'Delete sent for approval.') : t('leads.deleted', 'Lead deleted.'));
      void qc.invalidateQueries({ queryKey: ['leads'] });
    },
  });

  const openEdit = (lead: LeadRow) => {
    setEditing(lead);
    setEditForm({
      firstName: lead.firstName ?? '',
      lastName: lead.lastName ?? '',
      phone: lead.phone ?? '',
      email: lead.email ?? '',
      location: lead.location ?? '',
      propertyInterest: lead.propertyInterest ?? '',
      budget: lead.budget ?? '',
      status: lead.status ?? 'new',
      intent: lead.intent ?? 'unknown',
      urgency: lead.urgency ?? 'unknown',
    });
  };

  const confirmDelete = (lead: LeadRow) => {
    if (window.confirm(t('leads.deleteConfirm', 'Delete this lead? This cannot be undone.'))) {
      removeLead.mutate(lead._id);
    }
  };

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

      {notice && (
        <div className="flex items-center justify-between rounded-2xl bg-card-green px-4 py-3 text-sm">
          <span>{notice}</span>
          <button className="text-ink-soft hover:text-ink" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

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

      {editing && editForm && (
        <Card tone="blue">
          <div className="mb-4 flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            <h3 className="font-semibold">{t('leads.editLead', 'Edit lead')} — {editing.firstName} {editing.lastName}</h3>
          </div>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit.mutate({ id: editing._id, body: editForm });
            }}
          >
            <div>
              <Label>First name</Label>
              <Input required value={editForm.firstName} onChange={(e) => setEditForm((f) => f && { ...f, firstName: e.target.value })} />
            </div>
            <div>
              <Label>Last name</Label>
              <Input value={editForm.lastName} onChange={(e) => setEditForm((f) => f && { ...f, lastName: e.target.value })} />
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm((f) => f && { ...f, phone: e.target.value })} />
            </div>
            <div>
              <Label>Email</Label>
              <Input type="email" value={editForm.email} onChange={(e) => setEditForm((f) => f && { ...f, email: e.target.value })} />
            </div>
            <div>
              <Label>Location</Label>
              <Input value={editForm.location} onChange={(e) => setEditForm((f) => f && { ...f, location: e.target.value })} />
            </div>
            <div>
              <Label>Interest</Label>
              <Input value={editForm.propertyInterest} onChange={(e) => setEditForm((f) => f && { ...f, propertyInterest: e.target.value })} />
            </div>
            <div>
              <Label>Budget</Label>
              <Input value={editForm.budget} onChange={(e) => setEditForm((f) => f && { ...f, budget: e.target.value })} />
            </div>
            <div>
              <Label>Status</Label>
              <Select value={editForm.status} onChange={(e) => setEditForm((f) => f && { ...f, status: e.target.value })}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Intent</Label>
              <Select value={editForm.intent} onChange={(e) => setEditForm((f) => f && { ...f, intent: e.target.value })}>
                {INTENTS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Urgency</Label>
              <Select value={editForm.urgency} onChange={(e) => setEditForm((f) => f && { ...f, urgency: e.target.value })}>
                {URGENCIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-3">
              <Button type="submit" disabled={saveEdit.isPending}>
                {t('common.save', 'Save')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setEditing(null); setEditForm(null); }}>
                {t('common.cancel')}
              </Button>
              {saveEdit.isError && <p className="text-sm text-ink">{t('common.error')}</p>}
            </div>
          </form>
        </Card>
      )}

      <Input placeholder={t('leads.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm bg-surface" />

      {items.length === 0 ? (
        <EmptyState icon={Users} title={t('leads.empty')} hint={t('leads.emptyHint')} />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
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
              {items.map((lead) => {
                const open = expandedId === lead._id;
                return (
                  <Fragment key={lead._id}>
                    <tr className="hover:bg-surface-2/50">
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
                      <td className="px-6 py-3 capitalize text-ink-soft">
                        {lead.source}
                        {lead.scraped?.rating !== undefined && (
                          <span className="ms-2 inline-flex items-center gap-0.5 text-xs text-amber-600">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {lead.scraped.rating}
                          </span>
                        )}
                      </td>
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
                        <div className="flex items-center justify-end gap-1.5">
                          {hasModule(account, 'voice') && lead.phone && lead.status !== 'dnc' && (
                            <Button size="sm" variant="secondary" onClick={() => callLead.mutate(lead._id)} disabled={callLead.isPending} title={t('leads.callNow')}>
                              <PhoneOutgoing className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => openEdit(lead)} title={t('leads.edit', 'Edit')}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => confirmDelete(lead)} disabled={removeLead.isPending} title={t('leads.delete', 'Delete')}>
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setExpandedId(open ? null : lead._id)} title={t('leads.details', 'Details')}>
                            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr className="bg-surface-2/40">
                        <td colSpan={6} className="px-6 py-5">
                          <LeadDetail lead={lead} t={t} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** Full lead detail incl. everything the Apify scraper returned. */
function LeadDetail({ lead, t }: { lead: LeadRow; t: TFunction<'translation'> }) {
  const s = lead.scraped;
  const consent = lead.consent ?? {};
  const consentList = (['call', 'sms', 'whatsapp', 'email'] as const).filter((c) => consent[c]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      {s && (s.businessName || s.rating !== undefined || s.website || s.category || s.address) && (
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">
            {t('leads.scrapedData', 'Scraped data')} {s.sourceDetail?.startsWith('[MOCK]') && <Badge tone="neutral">sample</Badge>}
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Field label={t('leads.businessName', 'Business')} value={s.businessName} />
            <Field
              label={t('leads.rating', 'Rating')}
              value={
                s.rating !== undefined ? (
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {s.rating}
                    {s.reviewsCount !== undefined && <span className="text-ink-soft">({s.reviewsCount})</span>}
                  </span>
                ) : undefined
              }
            />
            <Field label={t('leads.category', 'Category')} value={s.category} />
            <Field
              label={t('leads.website', 'Website')}
              value={
                s.website ? (
                  <a href={s.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-forest underline">
                    <Globe className="h-3.5 w-3.5" /> {t('leads.visit', 'Visit')} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : undefined
              }
            />
            <div className="col-span-2">
              <Field label={t('leads.address', 'Address')} value={s.address} />
            </div>
            {s.googleMapsUrl && (
              <div className="col-span-2">
                <a href={s.googleMapsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-forest underline">
                  <MapPin className="h-3.5 w-3.5" /> {t('leads.viewOnMaps', 'View on Google Maps')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div className="col-span-2">
              <Field label={t('leads.sourceDetail', 'Source')} value={s.sourceDetail} />
            </div>
          </div>
        </div>
      )}

      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('leads.leadDetails', 'Lead details')}</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <Field label={t('leads.emailLabel', 'Email')} value={lead.email} />
          <Field label={t('leads.phoneLabel', 'Phone')} value={lead.phone} />
          <Field label={t('leads.locationLabel', 'Location')} value={lead.location} />
          <Field label={t('leads.interestLabel', 'Interest')} value={lead.propertyInterest} />
          <Field label={t('leads.intentLabel', 'Intent')} value={lead.intent} />
          <Field label={t('leads.urgencyLabel', 'Urgency')} value={lead.urgency} />
          <Field label={t('leads.budgetLabel', 'Budget')} value={lead.budget} />
          <Field label={t('leads.languageLabel', 'Language')} value={lead.locale?.toUpperCase()} />
          <Field label={t('leads.created', 'Added')} value={timeAgo(lead.createdAt)} />
          <div>
            <p className="text-xs text-ink-soft">{t('leads.consent', 'Consent')}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {consentList.length ? (
                consentList.map((c) => (
                  <Badge key={c} tone="green" className="uppercase">{c}</Badge>
                ))
              ) : (
                <span className="text-ink-soft">—</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-ink-soft">{label}</p>
      <p className="mt-0.5 break-words">{value === undefined || value === null || value === '' ? <span className="text-ink-soft">—</span> : value}</p>
    </div>
  );
}
