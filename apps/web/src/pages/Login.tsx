import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Home, PlayCircle, Zap, PhoneCall, MessagesSquare } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { useAuthStore, type SessionAccount, type SessionUser } from '../store/auth';

interface AuthResponse {
  accessToken: string;
  user: SessionUser;
  account: SessionAccount;
}

const DEMO_EMAIL = 'demo@truecode.ai';
const DEMO_PASSWORD = 'Demo1234!';

export function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen bg-app">
      <div className="hidden flex-1 flex-col justify-center p-16 lg:flex">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent">
          <Home className="h-7 w-7 text-accent-on" />
        </div>
        <h1 className="max-w-xl text-5xl font-semibold leading-[1.1] tracking-tight">{t('auth.welcome')}</h1>
        <p className="mt-4 max-w-md text-lg text-ink-soft">{t('auth.tagline')}</p>
        <div className="mt-10 flex gap-4">
          {[
            { icon: Zap, tone: 'bg-card-yellow', label: '< 60s replies' },
            { icon: PhoneCall, tone: 'bg-card-purple', label: 'AI voice booking' },
            { icon: MessagesSquare, tone: 'bg-card-pink', label: '5 languages' },
          ].map((f) => (
            <div key={f.label} className={`flex items-center gap-2 rounded-pill ${f.tone} px-4 py-2 text-sm font-medium`}>
              <f.icon className="h-4 w-4" /> {f.label}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-card bg-surface p-8 shadow-soft md:p-10">{children}</div>
      </div>
    </div>
  );
}

export default function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const doLogin = async (em: string, pw: string) => {
    setBusy(true);
    setError('');
    try {
      const data = await api<AuthResponse>('/auth/login', { method: 'POST', body: { email: em, password: pw } });
      setSession(data);
      navigate('/');
    } catch {
      setError(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void doLogin(email, password);
  };

  const demoLogin = async () => {
    setEmail(DEMO_EMAIL);
    setPassword(DEMO_PASSWORD);
    // Best-effort: ensure the demo account exists (dev auto-seeds; no-op in prod).
    await api('/auth/seed-demo', { method: 'POST' }).catch(() => undefined);
    await doLogin(DEMO_EMAIL, DEMO_PASSWORD);
  };

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold">{t('auth.login')}</h2>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <div>
          <Label htmlFor="email">{t('auth.email')}</Label>
          <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </div>
        <div>
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="rounded-2xl bg-card-pink px-4 py-2 text-sm">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {t('auth.login')}
        </Button>
      </form>

      {/* One-click demo */}
      <div className="my-5 flex items-center gap-3 text-xs text-ink-soft">
        <span className="h-px flex-1 bg-black/10" />
        {t('auth.or')}
        <span className="h-px flex-1 bg-black/10" />
      </div>
      <button
        type="button"
        onClick={() => void demoLogin()}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-pill bg-card-purple px-6 py-3 text-sm font-semibold text-ink transition-colors hover:brightness-95 disabled:opacity-50"
      >
        <PlayCircle className="h-5 w-5" /> {t('auth.demo')}
      </button>
      <p className="mt-2 text-center text-xs text-ink-soft">
        {t('auth.demoNote')} · <span className="font-mono">{DEMO_EMAIL}</span> / <span className="font-mono">{DEMO_PASSWORD}</span>
      </p>

      <p className="mt-6 text-center text-sm text-ink-soft">
        {t('auth.noAccount')}{' '}
        <Link to="/signup" className="font-medium text-ink underline">
          {t('auth.signup')}
        </Link>
      </p>
    </AuthLayout>
  );
}
