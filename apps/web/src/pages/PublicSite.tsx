import { useMutation, useQuery } from '@tanstack/react-query';
import { Home, MapPin, Phone } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input, Label } from '../components/ui/input';
import { PageSkeleton } from '../components/ui/skeleton';

const BASE = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL) : '/api';

/** M7 — public realtor site (premium pastel theme). Form → instant-reply webhook. */
export default function PublicSite() {
  const { slug } = useParams();
  const [form, setForm] = useState({ firstName: '', phone: '', propertyInterest: '' });
  const [sent, setSent] = useState(false);

  const site = useQuery({
    queryKey: ['site', slug],
    queryFn: async () => {
      const res = await fetch(`${BASE}/website/public/${slug}`);
      if (!res.ok) throw new Error('not_found');
      return (await res.json()) as { accountId: string; name: string; ownerName?: string };
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BASE}/webhook/lead/${site.data!.accountId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, source: 'website' }),
      });
      if (!res.ok) throw new Error('failed');
    },
    onSuccess: () => setSent(true),
  });

  if (site.isLoading) return <div className="p-10"><PageSkeleton /></div>;
  if (site.isError) return <div className="flex min-h-screen items-center justify-center bg-app text-ink-soft">Site not found</div>;
  const s = site.data!;

  return (
    <div className="min-h-screen bg-app">
      <div className="mx-auto max-w-5xl px-6 py-12">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent">
            <Home className="h-5 w-5 text-accent-on" />
          </div>
          <p className="text-lg font-semibold">{s.name}</p>
        </header>

        <section className="mt-16 grid items-center gap-12 lg:grid-cols-2">
          <div>
            <h1 className="text-5xl font-semibold leading-[1.08] tracking-tight">
              Find your next home with {s.ownerName ?? s.name}
            </h1>
            <p className="mt-5 max-w-md text-lg text-ink-soft">
              Local expertise, multilingual service, and a response in under a minute — day or night.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              {[
                { icon: Phone, label: 'Replies in <60s' },
                { icon: MapPin, label: 'Neighborhood expert' },
              ].map((f) => (
                <span key={f.label} className="flex items-center gap-2 rounded-pill bg-surface px-4 py-2 text-sm font-medium shadow-soft">
                  <f.icon className="h-4 w-4" /> {f.label}
                </span>
              ))}
            </div>
          </div>

          <Card className="p-8">
            {sent ? (
              <div className="py-10 text-center">
                <p className="text-4xl">⚡</p>
                <h3 className="mt-4 text-xl font-semibold">You're in!</h3>
                <p className="mt-2 text-ink-soft">Expect a message from us within seconds.</p>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit.mutate();
                }}
              >
                <h3 className="text-xl font-semibold">Tell us what you're looking for</h3>
                <div>
                  <Label>Name</Label>
                  <Input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input required placeholder="+1…" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <Label>What are you looking for?</Label>
                  <Input value={form.propertyInterest} onChange={(e) => setForm((f) => ({ ...f, propertyInterest: e.target.value }))} placeholder="3BR condo in Brickell…" />
                </div>
                <Button type="submit" size="lg" className="w-full" disabled={submit.isPending}>
                  Get instant answers
                </Button>
                <p className="text-center text-xs text-ink-soft">By submitting you agree to receive calls/texts. Reply STOP anytime.</p>
              </form>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
