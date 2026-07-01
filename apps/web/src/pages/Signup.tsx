import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { useAuthStore, type SessionAccount, type SessionUser } from '../store/auth';
import { AuthLayout } from './Login';

export default function Signup() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const setSession = useAuthStore((s) => s.setSession);
  const [form, setForm] = useState({ accountName: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = await api<{ accessToken: string; user: SessionUser; account: SessionAccount }>('/auth/signup', {
        method: 'POST',
        body: form,
      });
      setSession(data);
      navigate('/');
    } catch (err) {
      setError((err as Error).message === 'email_taken' ? 'Email already registered' : t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h2 className="text-2xl font-semibold">{t('auth.signup')}</h2>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <div>
          <Label htmlFor="accountName">{t('auth.company')}</Label>
          <Input id="accountName" required minLength={2} value={form.accountName} onChange={set('accountName')} />
        </div>
        <div>
          <Label htmlFor="name">{t('auth.name')}</Label>
          <Input id="name" required minLength={2} value={form.name} onChange={set('name')} />
        </div>
        <div>
          <Label htmlFor="email">{t('auth.email')}</Label>
          <Input id="email" type="email" required value={form.email} onChange={set('email')} />
        </div>
        <div>
          <Label htmlFor="password">{t('auth.password')}</Label>
          <Input id="password" type="password" required minLength={8} value={form.password} onChange={set('password')} />
        </div>
        {error && <p className="rounded-2xl bg-card-pink px-4 py-2 text-sm">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {t('auth.signup')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        {t('auth.haveAccount')}{' '}
        <Link to="/login" className="font-medium text-ink underline">
          {t('auth.login')}
        </Link>
      </p>
    </AuthLayout>
  );
}
