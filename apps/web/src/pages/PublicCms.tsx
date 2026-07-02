import { DEFAULT_THEME, type Block } from '@truecode/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BlockView } from '../components/cms/BlockView';

const BASE = import.meta.env.VITE_API_URL ? String(import.meta.env.VITE_API_URL) : '/api';

interface SiteConfig {
  brandName: string; tagline?: string; logoUrl?: string;
  theme?: { primaryColor?: string; accentColor?: string; bgColor?: string; font?: string };
  contact?: { phone?: string; email?: string; address?: string };
  social?: Record<string, string>; nav?: { label: string; href: string }[]; footerText?: string;
  seo?: { metaTitle?: string; metaDescription?: string };
}
interface IndexResp { webhookUrl: string; config: SiteConfig; pages: { title: string; slug: string; showInNav?: boolean; isHome?: boolean }[]; posts: { title: string; slug: string; excerpt?: string; coverImageUrl?: string; publishedAt?: string }[]; home: { title: string; blocks: Block[] } | null; }
interface ContentResp { webhookUrl: string; config: SiteConfig; content: { type: string; title: string; slug: string; blocks: Block[]; coverImageUrl?: string; seo?: { metaTitle?: string; metaDescription?: string } }; }

export default function PublicCms() {
  const { slug, contentSlug } = useParams<{ slug: string; contentSlug?: string }>();
  const [data, setData] = useState<IndexResp | ContentResp | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null); setError(false);
    const url = contentSlug ? `${BASE}/public-cms/${slug}/content/${contentSlug}` : `${BASE}/public-cms/${slug}`;
    fetch(url).then((r) => (r.ok ? r.json() : Promise.reject())).then(setData).catch(() => setError(true));
  }, [slug, contentSlug]);

  useEffect(() => {
    if (!data) return;
    const seo = 'content' in data ? data.content.seo : data.config.seo;
    document.title = seo?.metaTitle || ('content' in data ? data.content.title : data.config.brandName) || 'Site';
  }, [data]);

  if (error) return <Centered>This site isn't available.</Centered>;
  if (!data) return <Centered><div className="cf-working h-10 w-10 rounded-full bg-black/10" /></Centered>;

  const config = data.config;
  const theme = { ...DEFAULT_THEME, ...config.theme };
  const accent = theme.accentColor ?? DEFAULT_THEME.accentColor;
  const navItems = config.nav?.length ? config.nav : (('pages' in data ? data.pages : []).filter((p) => p.showInNav).map((p) => ({ label: p.title, href: `/read/${slug}/${p.slug}` })));

  const blocks: Block[] = 'content' in data ? data.content.blocks : (data.home?.blocks ?? []);
  const posts = 'pages' in data ? data.posts : [];

  return (
    <div style={{ background: theme.bgColor, color: theme.primaryColor, fontFamily: theme.font === 'serif' ? 'Georgia, serif' : undefined }} className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-black/5 bg-white/80 px-6 py-4 backdrop-blur">
        <Link to={`/read/${slug}`} className="flex items-center gap-2 font-bold">
          {config.logoUrl ? <img src={config.logoUrl} alt="" className="h-8" /> : <span className="text-lg">{config.brandName}</span>}
        </Link>
        <nav className="hidden gap-5 text-sm md:flex">
          {navItems.map((n, i) => n.href.startsWith('/read/') ? <Link key={i} to={n.href} className="hover:opacity-70">{n.label}</Link> : <a key={i} href={n.href} className="hover:opacity-70">{n.label}</a>)}
        </nav>
      </header>

      {/* Body */}
      <main className="mx-auto max-w-6xl px-4 py-8">
        {'content' in data && (
          <div className="mb-2">
            <Link to={`/read/${slug}`} className="text-sm opacity-60 hover:opacity-100">← {config.brandName}</Link>
            <h1 className="mt-2 text-4xl font-bold">{data.content.title}</h1>
            {data.content.coverImageUrl && <img src={data.content.coverImageUrl} alt="" className="mt-4 w-full rounded-3xl" />}
          </div>
        )}
        {blocks.length === 0 && !('content' in data) ? (
          <div className="py-16 text-center">
            <h1 className="text-4xl font-bold">{config.brandName}</h1>
            {config.tagline && <p className="mt-2 text-lg opacity-70">{config.tagline}</p>}
          </div>
        ) : (
          blocks.map((b, i) => <BlockView key={b.id ?? i} block={b} accent={accent} webhookUrl={'webhookUrl' in data ? data.webhookUrl : undefined} />)
        )}

        {/* Blog index on home */}
        {!('content' in data) && posts.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-6 text-3xl font-semibold">Latest articles</h2>
            <div className="grid gap-5 md:grid-cols-3">
              {posts.map((p) => (
                <Link key={p.slug} to={`/read/${slug}/${p.slug}`} className="rounded-3xl bg-white p-4 shadow-sm transition-transform hover:-translate-y-0.5">
                  {p.coverImageUrl && <img src={p.coverImageUrl} alt="" className="mb-3 aspect-video w-full rounded-2xl object-cover" />}
                  <h3 className="font-semibold">{p.title}</h3>
                  {p.excerpt && <p className="mt-1 text-sm opacity-60">{p.excerpt}</p>}
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="mt-12 border-t border-black/5 px-6 py-8 text-center text-sm opacity-70">
        <div className="mb-2 flex justify-center gap-4">
          {Object.entries(config.social ?? {}).filter(([, v]) => v).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="capitalize hover:opacity-100">{k}</a>)}
        </div>
        {config.contact?.phone && <span>{config.contact.phone} · </span>}
        {config.contact?.email && <span>{config.contact.email}</span>}
        <p className="mt-2">{config.footerText || `© ${config.brandName}`}</p>
      </footer>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-screen items-center justify-center bg-app text-ink-soft">{children}</div>;
}
