import { Router, type Request, type Response } from 'express';
import { DEFAULT_THEME } from '@truecode/shared';
import { Account, CmsContent, SiteConfig } from '../models.js';

/**
 * Public CMS renderer — PUBLIC, unauthenticated. Serves an account's published
 * website by its `websiteSlug`. Returns only published content and the public
 * subset of the site config. Lead-capture blocks post to /webhook/lead/:id.
 */
export const publicCmsRouter = Router();

async function siteFor(slug: string) {
  const account = await Account.findOne({ websiteSlug: slug }).select('_id name ownerName locale').lean();
  if (!account) return null;
  const config = await SiteConfig.findOne({ accountId: account._id }).lean();
  return { account, config };
}

function publicConfig(accountName: string, config: Record<string, unknown> | null) {
  return {
    brandName: (config?.brandName as string) || accountName,
    tagline: config?.tagline ?? '',
    logoUrl: config?.logoUrl ?? '',
    theme: (config?.theme as object) ?? DEFAULT_THEME,
    contact: config?.contact ?? {},
    social: config?.social ?? {},
    seo: config?.seo ?? {},
    nav: (config?.nav as unknown[]) ?? [],
    footerText: config?.footerText ?? '',
  };
}

/** GET /:slug — site index: config, nav pages, published posts, and the home page. */
publicCmsRouter.get('/:slug', async (req: Request, res: Response) => {
  const site = await siteFor(String(req.params.slug));
  if (!site) return res.status(404).json({ error: 'not_found' });
  const { account, config } = site;
  const [pages, posts, home] = await Promise.all([
    CmsContent.find({ accountId: account._id, type: 'page', status: 'published' }).select('title slug showInNav navOrder isHome').sort({ navOrder: 1 }).lean(),
    CmsContent.find({ accountId: account._id, type: 'post', status: 'published' }).select('title slug excerpt coverImageUrl tags publishedAt').sort({ publishedAt: -1 }).limit(50).lean(),
    CmsContent.findOne({ accountId: account._id, type: 'page', status: 'published', isHome: true }).lean(),
  ]);
  return res.json({
    accountId: String(account._id),
    webhookUrl: `/webhook/lead/${String(account._id)}`,
    config: publicConfig(account.name, config as Record<string, unknown> | null),
    pages: pages.map((p) => ({ title: p.title, slug: p.slug, showInNav: p.showInNav, isHome: p.isHome })),
    posts: posts.map((p) => ({ title: p.title, slug: p.slug, excerpt: p.excerpt, coverImageUrl: p.coverImageUrl, tags: p.tags, publishedAt: p.publishedAt })),
    home: home ? { title: home.title, slug: home.slug, blocks: home.blocks, seo: home.seo } : null,
  });
});

/** GET /:slug/content/:contentSlug — a published page or post (increments views). */
publicCmsRouter.get('/:slug/content/:contentSlug', async (req: Request, res: Response) => {
  const site = await siteFor(String(req.params.slug));
  if (!site) return res.status(404).json({ error: 'not_found' });
  const content = await CmsContent.findOneAndUpdate(
    { accountId: site.account._id, slug: req.params.contentSlug, status: 'published' },
    { $inc: { views: 1 } },
    { new: true },
  ).lean();
  if (!content) return res.status(404).json({ error: 'not_found' });
  return res.json({
    accountId: String(site.account._id),
    webhookUrl: `/webhook/lead/${String(site.account._id)}`,
    config: publicConfig(site.account.name, site.config as Record<string, unknown> | null),
    content: {
      type: content.type, title: content.title, slug: content.slug, excerpt: content.excerpt,
      coverImageUrl: content.coverImageUrl, blocks: content.blocks, seo: content.seo, tags: content.tags,
      publishedAt: content.publishedAt,
    },
  });
});
