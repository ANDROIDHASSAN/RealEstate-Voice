import { useQuery } from '@tanstack/react-query';
import { CalendarCheck2, MessageCircleReply, Users, Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts';
import { PageHeader } from '../components/layout/PageHeader';
import { StatCard } from '../components/StatCard';
import { Badge } from '../components/ui/badge';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api } from '../lib/api';
import { initials, timeAgo } from '../lib/utils';
import { useAuthStore } from '../store/auth';

interface DashboardData {
  speedToLeadP50: number | null;
  speedToLeadTrend: { date: string; seconds: number; leads: number }[];
  leadsThisWeek: number;
  callsBooked: number;
  pipeline: { status: string; count: number }[];
  followupPerformance: { sent: number; replies: number };
}

interface LeadRow {
  _id: string;
  firstName: string;
  lastName?: string;
  status: string;
  source: string;
  createdAt: string;
  firstResponseSeconds?: number;
}

const PIE_COLORS = ['#F9DCDC', '#FCEBCB', '#E6DDF8', '#D2ECDB', '#D9E7F7', '#F4EEE7', '#1A1A1A'];

export default function Dashboard() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);

  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api<DashboardData>('/stats/dashboard') });
  const leads = useQuery({
    queryKey: ['leads', 'recent'],
    queryFn: () => api<{ items: LeadRow[] }>('/leads?limit=6'),
  });

  if (stats.isLoading) return <PageSkeleton />;
  if (stats.isError) return <ErrorState onRetry={() => void stats.refetch()} />;
  const d = stats.data!;
  const replyRate =
    d.followupPerformance.sent > 0
      ? Math.round((d.followupPerformance.replies / d.followupPerformance.sent) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader title={t('dashboard.greeting', { name: user?.name.split(' ')[0] })} subtitle={t('dashboard.subtitle')} />

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Zap}
          tone="yellow"
          value={d.speedToLeadP50 !== null ? `${d.speedToLeadP50}s` : '—'}
          label={t('dashboard.speedToLeadUnit')}
          sub={d.speedToLeadP50 !== null && d.speedToLeadP50 <= 60 ? `⚡ ${t('dashboard.greatResult')}` : undefined}
        />
        <StatCard icon={Users} tone="pink" value={d.leadsThisWeek} label={t('dashboard.leadsThisWeek')} />
        <StatCard icon={CalendarCheck2} tone="purple" value={d.callsBooked} label={t('dashboard.callsBooked')} />
        <StatCard icon={MessageCircleReply} tone="green" value={`${replyRate}%`} label={t('dashboard.replyRate')} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
        {/* Speed-to-lead trend — the reference "Activity" bar chart */}
        <Card className="lg:col-span-3">
          <div className="mb-6 flex items-center justify-between">
            <CardTitle>{t('dashboard.activity')}</CardTitle>
            <Badge tone="yellow">M1 · {t('dashboard.speedToLead')}</Badge>
          </div>
          {d.speedToLeadTrend.length === 0 ? (
            <p className="py-14 text-center text-sm text-ink-soft">{t('leads.empty')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.speedToLeadTrend} barSize={26}>
                <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} fontSize={12} stroke="#6B6B6B" />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.03)' }}
                  contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)', fontFamily: 'Poppins' }}
                  formatter={(value: number) => [`${value}s`, t('dashboard.speedToLead')]}
                />
                <Bar dataKey="seconds" radius={[10, 10, 10, 10]}>
                  {d.speedToLeadTrend.map((row, i) => (
                    <Cell key={i} fill={row.seconds <= 60 ? '#D2ECDB' : row.seconds <= 300 ? '#FCEBCB' : '#F9DCDC'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Pipeline donut */}
        <Card className="lg:col-span-2">
          <CardTitle className="mb-6">{t('dashboard.pipeline')}</CardTitle>
          {d.pipeline.length === 0 ? (
            <p className="py-14 text-center text-sm text-ink-soft">{t('leads.empty')}</p>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={150} height={150}>
                <PieChart>
                  <Pie data={d.pipeline} dataKey="count" nameKey="status" innerRadius={45} outerRadius={70} paddingAngle={3} strokeWidth={0}>
                    {d.pipeline.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 16, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.08)' }} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="space-y-2 text-sm">
                {d.pipeline.map((p, i) => (
                  <li key={p.status} className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                    <span className="capitalize text-ink-soft">{t(`leads.status.${p.status}`)}</span>
                    <span className="font-semibold">{p.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* Recent leads */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <CardTitle>{t('dashboard.recentLeads')}</CardTitle>
          <Link to="/leads" className="text-sm font-medium underline">
            {t('dashboard.viewAll')}
          </Link>
        </div>
        <ul className="divide-y divide-black/5">
          {(leads.data?.items ?? []).map((lead) => (
            <li key={lead._id} className="flex items-center gap-4 py-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-card-blue text-sm font-semibold">
                {initials(lead.firstName, lead.lastName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {lead.firstName} {lead.lastName}
                </p>
                <p className="text-xs text-ink-soft">
                  {lead.source} · {timeAgo(lead.createdAt)}
                </p>
              </div>
              {lead.firstResponseSeconds !== undefined && (
                <Badge tone="yellow">⚡ {lead.firstResponseSeconds}s</Badge>
              )}
              <Badge tone={lead.status === 'won' ? 'green' : lead.status === 'appointment' ? 'purple' : 'neutral'} className="capitalize">
                {t(`leads.status.${lead.status}`)}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
