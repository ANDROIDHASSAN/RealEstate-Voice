import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox as InboxIcon, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';
import { EmptyState, ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { cn, initials, timeAgo } from '../lib/utils';

interface ConversationRow {
  _id: string;
  channel: string;
  status: string;
  messages: { direction: string; text: string; ts: string; status?: string }[];
  leadId?: { firstName?: string; lastName?: string; locale?: string };
  updatedAt: string;
}

const channelTone: Record<string, 'green' | 'blue' | 'yellow' | 'purple'> = {
  whatsapp: 'green',
  sms: 'blue',
  email: 'yellow',
  instagram: 'purple',
};

export default function Inbox() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const conversations = useQuery({
    queryKey: ['conversations'],
    queryFn: () => api<{ items: ConversationRow[] }>('/conversations'),
    refetchInterval: 5000,
  });

  const reply = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) =>
      api(`/conversations/${id}/reply`, { method: 'POST', body: { text } }),
    onSuccess: () => {
      setDraft('');
      void qc.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  if (conversations.isLoading) return <PageSkeleton />;
  if (conversations.isError) return <ErrorState onRetry={() => void conversations.refetch()} />;
  const items = conversations.data?.items ?? [];
  const active = items.find((c) => c._id === selected) ?? items[0];

  return (
    <div className="space-y-6">
      <PageHeader title={t('inbox.title')} subtitle={t('inbox.subtitle')} />
      {items.length === 0 ? (
        <EmptyState icon={InboxIcon} title={t('inbox.empty')} />
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
          <Card className="p-3 lg:col-span-2">
            <ul className="divide-y divide-black/5">
              {items.map((c) => (
                <li key={c._id}>
                  <button
                    onClick={() => setSelected(c._id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-start transition-colors',
                      active?._id === c._id ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card-blue text-sm font-semibold">
                      {initials(c.leadId?.firstName, c.leadId?.lastName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c.leadId?.firstName} {c.leadId?.lastName}
                      </p>
                      <p className="truncate text-xs text-ink-soft" dir="auto">
                        {c.messages[c.messages.length - 1]?.text}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge tone={channelTone[c.channel] ?? 'blue'}>{c.channel}</Badge>
                      <span className="text-[10px] text-ink-soft">{timeAgo(c.updatedAt)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {active && (
            <Card className="flex max-h-[640px] flex-col lg:col-span-3">
              <div className="mb-4 flex items-center justify-between border-b border-black/5 pb-4">
                <p className="font-semibold">
                  {active.leadId?.firstName} {active.leadId?.lastName}
                </p>
                <Badge tone={active.status === 'ai' ? 'purple' : 'green'}>
                  {active.status === 'ai' ? `🤖 ${t('inbox.aiHandling')}` : t('inbox.human')}
                </Badge>
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto pe-2">
                {active.messages.map((m, i) => (
                  <div key={i} className={cn('flex', m.direction === 'outbound' ? 'justify-end' : 'justify-start')}>
                    <div
                      dir="auto"
                      className={cn(
                        'max-w-[75%] rounded-3xl px-4 py-2.5 text-sm',
                        m.direction === 'outbound' ? 'rounded-br-lg bg-accent text-accent-on' : 'rounded-bl-lg bg-surface-2',
                      )}
                    >
                      {m.text}
                      {m.status === 'blocked' && <span className="ms-2 text-xs opacity-70">🚫 compliance</span>}
                      {m.status === 'mock-sent' && <span className="ms-2 text-xs opacity-60">({t('common.mock')})</span>}
                    </div>
                  </div>
                ))}
              </div>
              <form
                className="mt-4 flex gap-3 border-t border-black/5 pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (draft.trim()) reply.mutate({ id: active._id, text: draft.trim() });
                }}
              >
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('inbox.reply')} className="bg-surface-2 border-0" />
                <Button type="submit" size="icon" disabled={reply.isPending || !draft.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
