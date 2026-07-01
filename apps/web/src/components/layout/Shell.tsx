import {
  BarChart3,
  Bot,
  CalendarHeart,
  CreditCard,
  Globe,
  Home,
  Inbox,
  LogOut,
  Phone,
  Radar,
  Settings,
  Sparkles,
  Users,
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { cn, initials } from '../../lib/utils';
import { hasModule, useAuthStore } from '../../store/auth';

interface NavItem {
  to: string;
  icon: typeof Home;
  labelKey: string;
  module?: string;
}

const NAV: NavItem[] = [
  { to: '/', icon: Home, labelKey: 'nav.dashboard' },
  { to: '/leads', icon: Users, labelKey: 'nav.leads', module: 'instantReply' },
  { to: '/voice', icon: Phone, labelKey: 'nav.voice', module: 'voice' },
  { to: '/followup', icon: CalendarHeart, labelKey: 'nav.followup', module: 'followup' },
  { to: '/inbox', icon: Inbox, labelKey: 'nav.inbox' },
  { to: '/lead-engine', icon: Radar, labelKey: 'nav.leadEngine', module: 'leadEngine' },
  { to: '/content', icon: Sparkles, labelKey: 'nav.content', module: 'content' },
  { to: '/agents', icon: Bot, labelKey: 'nav.agents', module: 'multiAgent' },
  { to: '/website', icon: Globe, labelKey: 'nav.website', module: 'website' },
];

const FOOTER_NAV: NavItem[] = [
  { to: '/billing', icon: CreditCard, labelKey: 'nav.billing' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

function RailLink({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const account = useAuthStore((s) => s.account);
  const locked = item.module ? !hasModule(account, item.module) : false;
  return (
    <NavLink
      to={item.to}
      title={t(item.labelKey) + (locked ? ' 🔒' : '')}
      className={({ isActive }) =>
        cn(
          'relative flex h-11 w-11 items-center justify-center rounded-2xl transition-colors',
          isActive ? 'bg-accent text-accent-on shadow-soft' : 'text-ink-soft hover:bg-black/5 hover:text-ink',
          locked && 'opacity-40',
        )
      }
    >
      <item.icon className="h-5 w-5" strokeWidth={2} />
    </NavLink>
  );
}

export function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, account, logout } = useAuthStore();

  const onLogout = async () => {
    try {
      await api('/auth/logout', { method: 'POST' });
    } catch {
      // local logout regardless
    }
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-app">
      <div className="mx-auto flex max-w-[1440px] gap-6 p-4 md:p-6">
        {/* Icon rail — collapses to bottom nav on mobile */}
        <aside className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-around rounded-card bg-surface p-2 shadow-soft md:static md:inset-auto md:flex md:min-h-[calc(100vh-3rem)] md:w-[76px] md:flex-col md:justify-start md:gap-2 md:p-4">
          <div className="hidden md:mb-4 md:flex md:h-11 md:w-11 md:items-center md:justify-center md:rounded-2xl md:bg-accent">
            <BarChart3 className="h-5 w-5 text-accent-on" />
          </div>
          {NAV.map((item) => (
            <RailLink key={item.to} item={item} />
          ))}
          <div className="hidden md:mt-auto md:flex md:flex-col md:gap-2">
            {FOOTER_NAV.map((item) => (
              <RailLink key={item.to} item={item} />
            ))}
            <button
              onClick={onLogout}
              title={t('nav.logout')}
              className="flex h-11 w-11 items-center justify-center rounded-2xl text-ink-soft transition-colors hover:bg-card-pink hover:text-ink"
            >
              <LogOut className="h-5 w-5" />
            </button>
            <div className="mt-2 flex h-11 w-11 items-center justify-center rounded-full bg-card-purple text-sm font-semibold">
              {initials(user?.name)}
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-24 md:pb-0">
          <header className="mb-6 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm text-ink-soft">{account?.name}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-pill bg-surface px-4 py-1.5 text-xs font-medium capitalize shadow-soft">
                {account?.plan}
              </span>
              <NavLink to="/settings" className="flex h-10 w-10 items-center justify-center rounded-full bg-card-yellow font-semibold">
                {initials(user?.name)}
              </NavLink>
            </div>
          </header>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
