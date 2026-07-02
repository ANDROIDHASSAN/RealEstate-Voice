import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DocStatus, type DocTemplate } from '@truecode/shared';
import { CheckCircle2, FileSignature, Link2, Loader2, Plus, Send, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { useAuthStore } from '../store/auth';

interface DocDoc {
  _id: string; number: string; title: string; templateKey?: string; client: { name: string; email?: string };
  propertyAddress?: string; body: string; status: DocStatus; signature?: { name: string; signedAt: string };
  publicToken?: string; createdAt: string;
}
const STATUS_TONE: Record<DocStatus, 'neutral' | 'blue' | 'purple' | 'green' | 'pink'> = {
  draft: 'neutral', sent: 'blue', viewed: 'purple', signed: 'green', declined: 'pink',
};

export default function Documents() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const account = useAuthStore((s) => s.account);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; title: string; clientName: string; clientEmail: string; propertyAddress: string; body: string; templateKey: string }>({ open: false, title: '', clientName: '', clientEmail: '', propertyAddress: '', body: '', templateKey: '' });

  const list = useQuery({ queryKey: ['documents'], queryFn: () => api<{ items: DocDoc[] }>('/documents') });
  const templates = useQuery({ queryKey: ['doc-templates'], queryFn: () => api<{ templates: DocTemplate[] }>('/documents/templates') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['documents'] }); };
  const selected = list.data?.items.find((d) => d._id === selectedId) ?? null;

  const applyTpl = (key: string) => {
    const tpl = templates.data?.templates.find((x) => x.key === key);
    if (!tpl) return;
    const body = tpl.body
      .replace(/\{\{brokerage\}\}/g, account?.name ?? 'our brokerage')
      .replace(/\{\{client\}\}/g, form.clientName || '[Client]')
      .replace(/\{\{property\}\}/g, form.propertyAddress || '[Property]')
      .replace(/\{\{commission\}\}/g, '3');
    setForm((f) => ({ ...f, templateKey: key, title: f.title || tpl.name, body }));
  };

  const create = useMutation({
    mutationFn: () => api<{ document: DocDoc }>('/documents', { method: 'POST', body: { title: form.title.trim(), templateKey: form.templateKey || undefined, client: { name: form.clientName.trim(), email: form.clientEmail.trim() || undefined }, propertyAddress: form.propertyAddress.trim() || undefined, body: form.body } }),
    onSuccess: (r) => { setForm((f) => ({ ...f, open: false })); setSelectedId(r.document._id); refresh(); },
  });
  const act = useMutation({
    mutationFn: (a: { id: string; kind: 'send' | 'delete' }) => a.kind === 'delete' ? api(`/documents/${a.id}`, { method: 'DELETE' }) : api<{ token: string }>(`/documents/${a.id}/send`, { method: 'POST' }),
    onSuccess: (res, a) => {
      if (a.kind === 'delete' && selectedId === a.id) setSelectedId(null);
      if (a.kind === 'send') { const tok = (res as { token: string }).token; void navigator.clipboard?.writeText(`${location.origin}/portal/document/${tok}`); }
      refresh();
    },
  });

  if (list.isLoading) return <PageSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  const items = list.data!.items;
  const inp = 'h-11 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';

  return (
    <div className="space-y-6">
      <PageHeader title={t('documents.title')} subtitle={t('documents.subtitle')}
        action={<Button onClick={() => { setForm((f) => ({ ...f, open: !f.open })); setSelectedId(null); }}>{form.open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />} {t('documents.newDoc')}</Button>} />

      {form.open && (
        <Card className="cf-step-in space-y-4">
          <CardTitle>{t('documents.newDoc')}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {templates.data?.templates.map((tpl) => (
              <button key={tpl.key} onClick={() => applyTpl(tpl.key)} className={`rounded-pill px-3 py-1.5 text-xs ${form.templateKey === tpl.key ? 'bg-accent text-accent-on' : 'bg-surface-2 hover:bg-card-purple'}`}>{tpl.name}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <input className={`col-span-2 ${inp}`} placeholder={t('documents.docTitle')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <input className={inp} placeholder={t('documents.client')} value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} />
            <input className={inp} placeholder={t('documents.clientEmail')} value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} />
            <input className={`col-span-2 ${inp}`} placeholder={t('documents.property')} value={form.propertyAddress} onChange={(e) => setForm({ ...form, propertyAddress: e.target.value })} />
          </div>
          <textarea rows={10} className="w-full rounded-2xl border border-black/5 bg-surface p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-ink/10" placeholder={t('documents.bodyPlaceholder')} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <Button onClick={() => form.title && form.clientName && form.body && create.mutate()} disabled={create.isPending || !form.title || !form.clientName || !form.body}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {t('documents.create')}
          </Button>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{t('documents.allDocs')} ({items.length})</p>
          {items.length === 0 && !form.open && <EmptyState icon={FileSignature} title={t('documents.emptyTitle')} hint={t('documents.emptyHint')} action={<Button onClick={() => setForm((f) => ({ ...f, open: true }))}><Plus className="h-4 w-4" /> {t('documents.newDoc')}</Button>} />}
          {items.map((d) => (
            <button key={d._id} onClick={() => setSelectedId(d._id)} className={cn('w-full rounded-card bg-surface p-4 text-left shadow-soft transition-all hover:brightness-[0.98]', selectedId === d._id && 'ring-2 ring-accent')}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate text-sm font-semibold">{d.title}</p><p className="text-xs text-ink-soft">{d.number} · {d.client.name}</p></div>
                <Badge tone={STATUS_TONE[d.status]} className="capitalize">{t(`documents.status.${d.status}`)}</Badge>
              </div>
              {d.signature?.name && <p className="mt-1 text-[11px] text-emerald-600">✓ {t('documents.signedBy')} {d.signature.name}</p>}
            </button>
          ))}
        </div>

        <div>
          {!selected && !form.open && <EmptyState icon={FileSignature} title={t('documents.selectTitle')} hint={t('documents.selectHint')} />}
          {selected && (
            <Card className="cf-step-in space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-xl font-semibold">{selected.title}</h2><p className="text-sm text-ink-soft">{selected.number} · {selected.client.name}</p></div>
                <Badge tone={STATUS_TONE[selected.status]} className="capitalize">{t(`documents.status.${selected.status}`)}</Badge>
              </div>
              <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-surface-2 p-4 font-sans text-sm leading-relaxed">{selected.body}</pre>
              {selected.signature?.name && (
                <div className="rounded-2xl bg-card-green p-3 text-sm"><CheckCircle2 className="mr-1 inline h-4 w-4" /> {t('documents.signedBy')} <strong>{selected.signature.name}</strong> {t('documents.on')} {new Date(selected.signature.signedAt).toLocaleString()}</div>
              )}
              <div className="flex flex-wrap gap-2 border-t border-black/5 pt-4">
                {selected.status === 'draft' && <Button size="sm" variant="secondary" onClick={() => act.mutate({ id: selected._id, kind: 'send' })}><Send className="h-4 w-4" /> {t('documents.sendForSign')}</Button>}
                {selected.publicToken && selected.status !== 'draft' && (
                  <Button size="sm" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/portal/document/${selected.publicToken}`); }}><Link2 className="h-4 w-4" /> {t('documents.copyLink')}</Button>
                )}
                <Button size="sm" variant="ghost" className="ml-auto text-rose-500" onClick={() => act.mutate({ id: selected._id, kind: 'delete' })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
