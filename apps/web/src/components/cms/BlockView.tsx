import { parseLines, type Block } from '@truecode/shared';
import { useState } from 'react';

const BASE = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL) : '/api';

/** Lead-capture form — posts to the account's public lead webhook. */
function ContactForm({ webhookUrl, accent }: { webhookUrl?: string; accent: string }) {
  const [f, setF] = useState({ firstName: '', phone: '', email: '', message: '' });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!webhookUrl || (!f.phone && !f.email) || !f.firstName) return;
    setBusy(true);
    try {
      const r = await fetch(`${BASE}${webhookUrl}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, source: 'website' }) });
      if (r.ok) setSent(true);
    } finally { setBusy(false); }
  };
  if (sent) return <p className="rounded-2xl bg-black/5 p-4 text-center">Thanks — we'll be in touch shortly!</p>;
  const inp = 'h-11 w-full rounded-xl border border-black/10 bg-white px-3 text-sm outline-none';
  return (
    <form onSubmit={submit} className="mx-auto grid max-w-md gap-3">
      <input className={inp} placeholder="Your name" value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} required />
      <div className="grid grid-cols-2 gap-3">
        <input className={inp} placeholder="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        <input className={inp} placeholder="Email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
      </div>
      <textarea className="rounded-xl border border-black/10 bg-white p-3 text-sm outline-none" rows={3} placeholder="How can we help?" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
      <button disabled={busy || !webhookUrl} className="h-11 rounded-xl font-medium text-white disabled:opacity-50" style={{ background: accent }}>{webhookUrl ? 'Send' : 'Preview only'}</button>
    </form>
  );
}

const d = (block: Block, key: string): string => String((block.data as Record<string, unknown>)?.[key] ?? '');

/** Renders one CMS block. Shared by the editor preview and the public site. */
export function BlockView({ block, accent, webhookUrl }: { block: Block; accent: string; webhookUrl?: string }) {
  switch (block.type) {
    case 'hero': {
      const align = d(block, 'align') === 'left' ? 'items-start text-left' : 'items-center text-center';
      const img = d(block, 'imageUrl');
      return (
        <section className={`relative flex flex-col justify-center gap-4 rounded-3xl px-8 py-20 ${align}`} style={img ? { backgroundImage: `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url(${img})`, backgroundSize: 'cover', backgroundPosition: 'center', color: '#fff' } : { background: '#F4EEE7' }}>
          <h1 className="max-w-3xl text-4xl font-bold leading-tight md:text-5xl">{d(block, 'heading') || 'Your headline here'}</h1>
          {d(block, 'subheading') && <p className="max-w-xl text-lg opacity-90">{d(block, 'subheading')}</p>}
          {d(block, 'ctaLabel') && <a href={d(block, 'ctaHref') || '#'} className="mt-2 inline-flex rounded-full px-6 py-3 font-medium text-white" style={{ background: accent }}>{d(block, 'ctaLabel')}</a>}
        </section>
      );
    }
    case 'richtext':
      return (
        <section className="mx-auto max-w-3xl px-2 py-8">
          {d(block, 'heading') && <h2 className="mb-4 text-3xl font-semibold">{d(block, 'heading')}</h2>}
          {d(block, 'body').split(/\n\s*\n/).filter(Boolean).map((p, i) => <p key={i} className="mb-4 leading-relaxed text-black/70">{p}</p>)}
        </section>
      );
    case 'image':
      return (
        <figure className="mx-auto max-w-4xl px-2 py-8 text-center">
          {d(block, 'url') ? <img src={d(block, 'url')} alt={d(block, 'alt')} className="mx-auto rounded-3xl" /> : <div className="rounded-3xl bg-black/5 py-24 text-black/40">Image</div>}
          {d(block, 'caption') && <figcaption className="mt-2 text-sm text-black/50">{d(block, 'caption')}</figcaption>}
        </figure>
      );
    case 'gallery': {
      const imgs = parseLines((block.data as Record<string, unknown>).images).map((r) => r[0]).filter(Boolean);
      return (
        <section className="mx-auto grid max-w-5xl grid-cols-2 gap-3 px-2 py-8 md:grid-cols-3">
          {imgs.length ? imgs.map((src, i) => <img key={i} src={src} alt="" className="aspect-square w-full rounded-2xl object-cover" />) : <p className="col-span-full text-center text-black/40">Add image URLs</p>}
        </section>
      );
    }
    case 'features': {
      const items = parseLines((block.data as Record<string, unknown>).items);
      return (
        <section className="mx-auto max-w-5xl px-2 py-10">
          {d(block, 'heading') && <h2 className="mb-8 text-center text-3xl font-semibold">{d(block, 'heading')}</h2>}
          <div className="grid gap-5 md:grid-cols-3">
            {items.map((it, i) => (
              <div key={i} className="rounded-2xl bg-black/[.03] p-6">
                <h3 className="mb-2 font-semibold" style={{ color: accent }}>{it[0]}</h3>
                <p className="text-sm text-black/60">{it[1] ?? ''}</p>
              </div>
            ))}
          </div>
        </section>
      );
    }
    case 'stats': {
      const items = parseLines((block.data as Record<string, unknown>).items);
      return (
        <section className="mx-auto flex max-w-4xl flex-wrap justify-around gap-6 rounded-3xl bg-black/[.03] px-6 py-10">
          {items.map((it, i) => (
            <div key={i} className="text-center"><p className="text-4xl font-bold" style={{ color: accent }}>{it[0]}</p><p className="mt-1 text-sm text-black/50">{it[1] ?? ''}</p></div>
          ))}
        </section>
      );
    }
    case 'testimonial':
      return (
        <section className="mx-auto max-w-2xl px-4 py-12 text-center">
          <p className="text-2xl font-medium leading-relaxed">“{d(block, 'quote') || 'A wonderful experience.'}”</p>
          <p className="mt-4 font-semibold">{d(block, 'author')}</p>
          <p className="text-sm text-black/50">{d(block, 'role')}</p>
        </section>
      );
    case 'cta':
      return (
        <section className="mx-auto my-8 max-w-4xl rounded-3xl px-8 py-12 text-center text-white" style={{ background: accent }}>
          <h2 className="text-3xl font-bold">{d(block, 'heading') || 'Ready to get started?'}</h2>
          {d(block, 'body') && <p className="mx-auto mt-2 max-w-xl opacity-90">{d(block, 'body')}</p>}
          {d(block, 'buttonLabel') && <a href={d(block, 'buttonHref') || '#'} className="mt-6 inline-flex rounded-full bg-white px-6 py-3 font-medium text-black">{d(block, 'buttonLabel')}</a>}
        </section>
      );
    case 'contact':
      return (
        <section id="contact" className="mx-auto max-w-2xl px-4 py-12 text-center">
          <h2 className="mb-2 text-3xl font-semibold">{d(block, 'heading') || 'Get in touch'}</h2>
          {d(block, 'note') && <p className="mb-6 text-black/60">{d(block, 'note')}</p>}
          <ContactForm webhookUrl={webhookUrl} accent={accent} />
        </section>
      );
    case 'html':
      return <section className="mx-auto max-w-4xl px-2 py-6" dangerouslySetInnerHTML={{ __html: d(block, 'code') }} />;
    case 'divider':
      return <hr className="mx-auto my-8 max-w-4xl border-black/10" />;
    default:
      return null;
  }
}
