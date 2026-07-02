import { Router, type Request, type Response } from 'express';
import { BLOCK_TYPES, cmsContentInputSchema, CONTENT_STATUSES, CONTENT_TYPES, siteConfigSchema, slugify } from '@truecode/shared';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { CmsContent, SiteConfig } from '../models.js';

export const cmsRouter = Router();
cmsRouter.use(requireAuth, requireModule('cms'), rbacWrite);

/** Ensure a unique slug per (account, type). */
async function uniqueSlug(accountId: string, type: string, base: string, excludeId?: string): Promise<string> {
  const root = slugify(base) || 'untitled';
  let slug = root;
  let n = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await CmsContent.findOne({ accountId, type, slug, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean()) {
    n += 1;
    slug = `${root}-${n}`;
  }
  return slug;
}

/** GET /blocks — the block-type registry that drives the editor. */
cmsRouter.get('/blocks', (_req: Request, res: Response) => {
  res.json({ blockTypes: BLOCK_TYPES });
});

// ---- Site settings ----
cmsRouter.get('/settings', async (req: Request, res: Response) => {
  const config = await SiteConfig.findOne({ accountId: req.auth!.accountId }).lean();
  res.json({ config: config ?? null });
});

cmsRouter.put('/settings', async (req: Request, res: Response) => {
  const parsed = siteConfigSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const config = await SiteConfig.findOneAndUpdate(
    { accountId: req.auth!.accountId },
    { $set: parsed.data },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();
  return res.json({ config });
});

// ---- Content (pages + posts) ----
cmsRouter.get('/stats', async (req: Request, res: Response) => {
  const items = await CmsContent.find({ accountId: req.auth!.accountId }).select('type status views').lean();
  const stat = { pages: 0, posts: 0, published: 0, drafts: 0, views: 0 };
  for (const c of items) {
    if (c.type === 'page') stat.pages += 1; else stat.posts += 1;
    if (c.status === 'published') stat.published += 1; else stat.drafts += 1;
    stat.views += Number(c.views ?? 0);
  }
  res.json({ stats: stat });
});

cmsRouter.get('/', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { accountId: req.auth!.accountId };
  const type = req.query.type as string | undefined;
  const status = req.query.status as string | undefined;
  if (type && (CONTENT_TYPES as readonly string[]).includes(type)) filter.type = type;
  if (status && (CONTENT_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const items = await CmsContent.find(filter).sort({ updatedAt: -1 }).limit(300).lean();
  res.json({ items });
});

cmsRouter.get('/:id', async (req: Request, res: Response) => {
  const content = await CmsContent.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!content) return res.status(404).json({ error: 'not_found' });
  return res.json({ content });
});

cmsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = cmsContentInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const accountId = req.auth!.accountId;
  const d = parsed.data;
  const slug = await uniqueSlug(accountId, d.type, d.slug || d.title);
  if (d.isHome && d.type === 'page') await CmsContent.updateMany({ accountId, type: 'page' }, { $set: { isHome: false } });
  const content = await CmsContent.create({
    accountId, createdBy: req.auth!.userId, type: d.type, title: d.title, slug, status: d.status,
    excerpt: d.excerpt, coverImageUrl: d.coverImageUrl, blocks: d.blocks, seo: d.seo, tags: d.tags,
    showInNav: d.showInNav, navOrder: d.navOrder, isHome: d.isHome,
    publishedAt: d.status === 'published' ? new Date() : undefined,
  });
  return res.status(201).json({ content });
});

cmsRouter.put('/:id', async (req: Request, res: Response) => {
  const parsed = cmsContentInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const accountId = req.auth!.accountId;
  const content = await CmsContent.findOne({ _id: req.params.id, accountId });
  if (!content) return res.status(404).json({ error: 'not_found' });
  const d = parsed.data;
  const slug = d.slug && d.slug !== content.slug ? await uniqueSlug(accountId, d.type, d.slug, String(content._id)) : content.slug;
  if (d.isHome && d.type === 'page') await CmsContent.updateMany({ accountId, type: 'page', _id: { $ne: content._id } }, { $set: { isHome: false } });
  Object.assign(content, {
    type: d.type, title: d.title, slug, status: d.status, excerpt: d.excerpt, coverImageUrl: d.coverImageUrl,
    blocks: d.blocks, seo: d.seo, tags: d.tags, showInNav: d.showInNav, navOrder: d.navOrder, isHome: d.isHome,
    publishedAt: d.status === 'published' ? content.publishedAt ?? new Date() : content.publishedAt,
  });
  await content.save();
  return res.json({ content });
});

cmsRouter.post('/:id/publish', async (req: Request, res: Response) => {
  const content = await CmsContent.findOneAndUpdate(
    { _id: req.params.id, accountId: req.auth!.accountId },
    { $set: { status: 'published', publishedAt: new Date() } },
    { new: true },
  ).lean();
  if (!content) return res.status(404).json({ error: 'not_found' });
  return res.json({ content });
});

cmsRouter.post('/:id/unpublish', async (req: Request, res: Response) => {
  const content = await CmsContent.findOneAndUpdate(
    { _id: req.params.id, accountId: req.auth!.accountId },
    { $set: { status: 'draft' } },
    { new: true },
  ).lean();
  if (!content) return res.status(404).json({ error: 'not_found' });
  return res.json({ content });
});

cmsRouter.post('/:id/duplicate', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const src = await CmsContent.findOne({ _id: req.params.id, accountId }).lean();
  if (!src) return res.status(404).json({ error: 'not_found' });
  const slug = await uniqueSlug(accountId, src.type as string, `${src.slug}-copy`);
  const clone = await CmsContent.create({
    accountId, createdBy: req.auth!.userId, type: src.type, title: `${src.title} (copy)`, slug, status: 'draft',
    excerpt: src.excerpt, coverImageUrl: src.coverImageUrl, blocks: src.blocks, seo: src.seo, tags: src.tags,
    showInNav: false, navOrder: src.navOrder, isHome: false,
  });
  return res.status(201).json({ content: clone });
});

cmsRouter.delete('/:id', async (req: Request, res: Response) => {
  const content = await CmsContent.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!content) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});
