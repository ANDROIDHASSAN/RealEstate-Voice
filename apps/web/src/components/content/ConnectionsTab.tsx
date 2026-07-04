import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PLATFORM_META, SOCIAL_PLATFORMS, type SocialPlatform } from '@truecode/shared';
import { Link2, Plug, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardDescription, CardTitle } from '../ui/card';
import { ErrorState } from '../ui/states';
import { api } from '../../lib/api';
import { PlatformDot, StatusDot, type ConnectionRow } from './primitives';

type Status = ConnectionRow['status'];

const STATUS_BADGE: Record<Status, { tone: 'green' | 'yellow' | 'neutral' | 'pink'; key: string }> = {
  connected: { tone: 'green', key: 'content.connections.status.connected' },
  pending: { tone: 'yellow', key: 'content.connections.status.pending' },
  disconnected: { tone: 'neutral', key: 'content.connections.status.disconnected' },
  error: { tone: 'pink', key: 'content.connections.status.error' },
};

export function ConnectionsTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const connections = useQuery({
    queryKey: ['content-connections'],
    queryFn: () => api<{ items: ConnectionRow[] }>('/content/connections'),
    refetchInterval: 10000,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['content-connections'] });
    void qc.invalidateQueries({ queryKey: ['content-overview'] });
  };

  const connect = useMutation({
    mutationFn: (platform: SocialPlatform) =>
      api('/content/connections', { method: 'POST', body: { platform } }),
    onSuccess: invalidate,
  });

  const disconnect = useMutation({
    mutationFn: (platform: SocialPlatform) =>
      api(`/content/connections/${platform}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const pendingPlatform =
    (connect.isPending && (connect.variables as SocialPlatform)) ||
    (disconnect.isPending && (disconnect.variables as SocialPlatform)) ||
    null;

  return (
    <div className="space-y-5">
      {/* Intro */}
      <Card tone="blue">
        <div className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          <CardTitle>{t('content.connections.title')}</CardTitle>
        </div>
        <CardDescription className="mt-2">{t('content.connections.intro')}</CardDescription>
      </Card>

      {connections.isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SOCIAL_PLATFORMS.map((p) => (
            <Card key={p} className="animate-pulse">
              <div className="mb-4 h-8 w-8 rounded-full bg-surface-2" />
              <div className="mb-2 h-4 w-24 rounded bg-surface-2" />
              <div className="mb-4 h-3 w-32 rounded bg-surface-2" />
              <div className="h-11 w-full rounded-pill bg-surface-2" />
            </Card>
          ))}
        </div>
      ) : connections.isError ? (
        <ErrorState onRetry={() => void connections.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(connections.data?.items ?? []).map((c) => {
            const meta = PLATFORM_META[c.platform];
            const badge = STATUS_BADGE[c.status];
            const busy = pendingPlatform === c.platform;
            return (
              <Card
                key={c.platform}
                className="flex flex-col border-t-4"
                style={{ borderTopColor: c.color || meta.color }}
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PlatformDot platform={c.platform} />
                    <span className="font-semibold text-ink">{c.label || meta.label}</span>
                  </div>
                  <Badge tone={badge.tone}>{t(badge.key)}</Badge>
                </div>

                {/* Identity */}
                <div className="mt-3 space-y-1 text-sm text-ink-soft">
                  {c.displayName && <p className="font-medium text-ink">{c.displayName}</p>}
                  {c.status === 'connected' && c.connectedAt && (
                    <p className="text-xs">
                      {t('content.connections.connectedOn', {
                        date: new Date(c.connectedAt).toLocaleDateString(),
                      })}
                    </p>
                  )}
                </div>

                {/* Live/mock hint */}
                {!c.live && c.reason && (
                  <p className="mt-2 text-xs text-ink-soft">{c.reason}</p>
                )}

                <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                  <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                    <StatusDot ok={c.live} warn={!c.live && c.status !== 'disconnected'} />
                    {c.live
                      ? t('content.connections.liveMode')
                      : t('content.connections.mockMode')}
                  </span>

                  {c.status === 'connected' ? (
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busy}
                      onClick={() => disconnect.mutate(c.platform)}
                    >
                      {busy ? '…' : t('content.connections.disconnect')}
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={busy}
                      onClick={() => connect.mutate(c.platform)}
                    >
                      {c.live ? <Plug className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                      {busy ? '…' : t('content.connections.connect')}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
