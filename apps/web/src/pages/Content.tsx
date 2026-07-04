import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  DollarSign,
  Images,
  Link2,
  Megaphone,
  Radar,
  Send,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { AdsTab } from '../components/content/AdsTab';
import { CalendarTab } from '../components/content/CalendarTab';
import { ComposerTab } from '../components/content/ComposerTab';
import { ConnectionsTab } from '../components/content/ConnectionsTab';
import { MediaTab } from '../components/content/MediaTab';
import { ResearchTab } from '../components/content/ResearchTab';
import type { Overview } from '../components/content/primitives';
import { api } from '../lib/api';
import { hasModule, useAuthStore } from '../store/auth';

type TabKey = 'compose' | 'calendar' | 'media' | 'connections' | 'ads' | 'research';

export default function Content() {
  const { t } = useTranslation();
  const account = useAuthStore((s) => s.account);
  const adsEnabled = hasModule(account, 'ads');
  const [tab, setTab] = useState<TabKey>('compose');

  const overview = useQuery({
    queryKey: ['content-overview'],
    queryFn: () => api<Overview>('/content/overview'),
    refetchInterval: 12000,
  });

  const TABS: { key: TabKey; label: string; icon: typeof Sparkles; gated?: boolean }[] = [
    { key: 'compose', label: t('content.tabs.compose'), icon: Sparkles },
    { key: 'calendar', label: t('content.tabs.calendar'), icon: CalendarDays },
    { key: 'media', label: t('content.tabs.media'), icon: Images },
    { key: 'connections', label: t('content.tabs.connections'), icon: Link2 },
    { key: 'ads', label: t('content.tabs.ads'), icon: Megaphone, gated: !adsEnabled },
    { key: 'research', label: t('content.tabs.research'), icon: Radar, gated: !adsEnabled },
  ];

  if (overview.isLoading) return <PageSkeleton />;
  if (overview.isError) return <ErrorState onRetry={() => void overview.refetch()} />;
  const s = overview.data!.stats;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('content.title')}
        subtitle={t('content.subtitle')}
        action={
          <Badge tone="ink">
            <Send className="mr-1 h-3.5 w-3.5" /> {s.connections} {t('content.connected')}
          </Badge>
        }
      />

      {/* Studio KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={CalendarDays} tone="purple" label={t('content.kpi.scheduled')} value={s.scheduled} />
        <StatCard icon={Send} tone="green" label={t('content.kpi.published')} value={s.published} />
        <StatCard icon={Images} tone="blue" label={t('content.kpi.media')} value={s.mediaCount} />
        <StatCard icon={Megaphone} tone="yellow" label={t('content.kpi.campaigns')} value={s.activeCampaigns} />
        <StatCard icon={DollarSign} tone="pink" label={t('content.kpi.spend')} value={`$${Math.round(s.totalSpend)}`} sub={`${s.totalLeads} ${t('content.kpi.leads')}`} />
        <StatCard icon={TrendingUp} tone="green" label={t('content.kpi.watched')} value={s.watchedCount} />
      </div>

      {/* Tab bar */}
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((tb) => {
          const active = tab === tb.key;
          return (
            <button
              key={tb.key}
              onClick={() => setTab(tb.key)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-pill px-4 py-2.5 text-sm font-medium transition-colors ${
                active ? 'bg-accent text-accent-on shadow-soft' : 'bg-surface text-ink-soft hover:bg-surface-2'
              }`}
            >
              <tb.icon className="h-4 w-4" />
              {tb.label}
              {tb.gated && <span className="ml-1 text-xs opacity-60">🔒</span>}
            </button>
          );
        })}
      </div>

      {/* Active tab */}
      {tab === 'compose' && <ComposerTab overview={overview.data!} />}
      {tab === 'calendar' && <CalendarTab overview={overview.data!} />}
      {tab === 'media' && <MediaTab />}
      {tab === 'connections' && <ConnectionsTab />}
      {tab === 'ads' && (adsEnabled ? <AdsTab /> : <LockedTab kind="ads" />)}
      {tab === 'research' && (adsEnabled ? <ResearchTab /> : <LockedTab kind="research" />)}
    </div>
  );
}

function LockedTab({ kind }: { kind: 'ads' | 'research' }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-card bg-card-purple p-10 text-center">
      <p className="text-lg font-semibold">{t(`content.locked.${kind}Title`)}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{t(`content.locked.${kind}Hint`)}</p>
    </div>
  );
}
