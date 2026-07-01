import { useMutation } from '@tanstack/react-query';
import { ExternalLink, Globe } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/button';
import { Card, CardDescription, CardTitle } from '../components/ui/card';
import { Input, Label } from '../components/ui/input';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';

export default function Website() {
  const { t } = useTranslation();
  const { account, setAccount } = useAuthStore();
  const [slug, setSlug] = useState(account?.websiteSlug ?? '');
  const [error, setError] = useState('');

  const provision = useMutation({
    mutationFn: () => api<{ slug: string; url: string }>('/website/provision', { method: 'POST', body: { slug } }),
    onSuccess: (d) => {
      setError('');
      if (account) setAccount({ ...account, websiteSlug: d.slug });
    },
    onError: (e) => setError((e as Error).message === 'slug_taken' ? 'That address is taken' : t('common.error')),
  });

  return (
    <div className="space-y-6">
      <PageHeader title={t('nav.website')} subtitle="Your lead-capturing realtor site — every form fires the instant-reply engine" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card tone="green">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-5 w-5" />
            <CardTitle>Site address</CardTitle>
          </div>
          <form
            className="flex gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (slug.trim()) provision.mutate();
            }}
          >
            <div className="flex-1">
              <Label>closeflow.io / site /</Label>
              <Input
                required
                pattern="[a-z0-9-]+"
                minLength={3}
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                placeholder="your-name"
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" disabled={provision.isPending}>
                {t('common.save')}
              </Button>
            </div>
          </form>
          {error && <p className="mt-3 rounded-2xl bg-card-pink px-4 py-2 text-sm">{error}</p>}
          {account?.websiteSlug && (
            <Link to={`/site/${account.websiteSlug}`} className="mt-4 inline-flex items-center gap-2 text-sm font-medium underline">
              <ExternalLink className="h-4 w-4" /> /site/{account.websiteSlug}
            </Link>
          )}
        </Card>

        <Card>
          <CardTitle className="mb-1">Lead intake webhook</CardTitle>
          <CardDescription className="mb-4">
            Point Zillow, Facebook Lead Ads, or Zapier here — every POST becomes a lead with an instant reply.
          </CardDescription>
          <code dir="ltr" className="block break-all rounded-2xl bg-surface-2 p-4 text-xs">
            POST {import.meta.env.VITE_API_URL || 'http://localhost:4100'}/webhook/lead/{account?._id}
          </code>
          <p className="mt-3 text-xs text-ink-soft">
            Body: {'{ "firstName", "phone" | "email", "source", "propertyInterest", "locale" }'}
          </p>
        </Card>
      </div>
    </div>
  );
}
