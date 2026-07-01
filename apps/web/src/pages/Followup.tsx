import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarHeart, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { Input, Label, Select, Textarea } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';

interface SequenceRow {
  _id: string;
  name: string;
  locale: string;
  steps: { delayHours: number; channel: string; template: string }[];
}

interface EnrollmentRow {
  _id: string;
  status: string;
  currentStep: number;
  nextRunAt?: string;
  leadId?: { firstName?: string; lastName?: string };
  sequenceId?: { name?: string };
}

interface StepDraft {
  delayHours: number;
  channel: 'sms' | 'whatsapp' | 'email';
  template: string;
}

export default function Followup() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [locale, setLocale] = useState('en');
  const [steps, setSteps] = useState<StepDraft[]>([
    { delayHours: 0, channel: 'sms', template: 'Hi {{lead.firstName}}, great connecting!' },
  ]);

  const sequences = useQuery({ queryKey: ['sequences'], queryFn: () => api<{ items: SequenceRow[] }>('/sequences') });
  const enrollments = useQuery({
    queryKey: ['enrollments'],
    queryFn: () => api<{ items: EnrollmentRow[] }>('/sequences/enrollments'),
    refetchInterval: 8000,
  });

  const create = useMutation({
    mutationFn: () => api('/sequences', { method: 'POST', body: { name, locale, steps } }),
    onSuccess: () => {
      setShowForm(false);
      setName('');
      setSteps([{ delayHours: 0, channel: 'sms', template: 'Hi {{lead.firstName}}, great connecting!' }]);
      void qc.invalidateQueries({ queryKey: ['sequences'] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/sequences/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sequences'] }),
  });

  if (sequences.isLoading) return <PageSkeleton />;
  if (sequences.isError) return <ErrorState onRetry={() => void sequences.refetch()} />;
  const items = sequences.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('followup.title')}
        subtitle={t('followup.subtitle')}
        action={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus className="h-4 w-4" /> {t('followup.newSequence')}
          </Button>
        }
      />

      {showForm && (
        <Card tone="blue">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Name</Label>
                <Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>Language</Label>
                <Select value={locale} onChange={(e) => setLocale(e.target.value)}>
                  <option value="en">English</option>
                  <option value="es">Español</option>
                  <option value="ar">العربية</option>
                  <option value="pt">Português</option>
                  <option value="ht">Kreyòl</option>
                </Select>
              </div>
            </div>
            {steps.map((step, i) => (
              <div key={i} className="grid gap-3 rounded-2xl bg-surface p-4 sm:grid-cols-[110px,140px,1fr]">
                <div>
                  <Label>+ hours</Label>
                  <Input
                    type="number"
                    min={0}
                    value={step.delayHours}
                    onChange={(e) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, delayHours: Number(e.target.value) } : x)))}
                  />
                </div>
                <div>
                  <Label>Channel</Label>
                  <Select
                    value={step.channel}
                    onChange={(e) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, channel: e.target.value as StepDraft['channel'] } : x)))}
                  >
                    <option value="sms">SMS</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">Email</option>
                  </Select>
                </div>
                <div>
                  <Label>Message ({'{{lead.firstName}}'} works)</Label>
                  <Textarea
                    required
                    className="min-h-[48px]"
                    value={step.template}
                    onChange={(e) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, template: e.target.value } : x)))}
                  />
                </div>
              </div>
            ))}
            <div className="flex gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => setSteps((s) => [...s, { delayHours: 24, channel: 'sms', template: '' }])}>
                <Plus className="h-4 w-4" /> Step
              </Button>
              <Button type="submit" size="sm" disabled={create.isPending}>
                {t('common.create')}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState icon={CalendarHeart} title={t('followup.empty')} hint={t('followup.emptyHint')} />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {items.map((seq, i) => (
            <Card key={seq._id} tone={(['pink', 'yellow', 'purple', 'green', 'blue'] as const)[i % 5]}>
              <div className="flex items-start justify-between">
                <CardTitle>{seq.name}</CardTitle>
                <button onClick={() => remove.mutate(seq._id)} className="text-ink-soft hover:text-ink" title="Delete">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                {seq.steps.length} {t('followup.steps')} · {seq.locale.toUpperCase()}
              </p>
              <ol className="mt-4 space-y-2">
                {seq.steps.map((s, j) => (
                  <li key={j} className="flex items-center gap-2 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface/80 text-xs font-semibold">{j + 1}</span>
                    <Badge tone="neutral">{s.channel}</Badge>
                    <span className="text-xs text-ink-soft">+{s.delayHours}h</span>
                    <span className="truncate text-xs">{s.template}</span>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardTitle className="mb-4">{t('followup.enrollments')}</CardTitle>
        <ul className="divide-y divide-black/5 text-sm">
          {(enrollments.data?.items ?? []).map((e) => (
            <li key={e._id} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1 truncate font-medium">
                {e.leadId?.firstName} {e.leadId?.lastName}
              </span>
              <span className="truncate text-ink-soft">{e.sequenceId?.name}</span>
              <span className="text-xs text-ink-soft">step {e.currentStep}</span>
              <Badge tone={e.status === 'active' ? 'green' : e.status === 'paused' ? 'yellow' : 'neutral'}>{e.status}</Badge>
            </li>
          ))}
          {(enrollments.data?.items.length ?? 0) === 0 && <p className="py-4 text-ink-soft">—</p>}
        </ul>
      </Card>
    </div>
  );
}
