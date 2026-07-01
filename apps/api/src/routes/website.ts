import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { Account } from '../models.js';

export const websiteRouter = Router();

const slugSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, numbers, hyphens'),
  headline: z.string().max(140).optional(),
  bio: z.string().max(1000).optional(),
});

/** M7 — provision a per-account realtor site (subpath locally; subdomain in prod). */
websiteRouter.post('/provision', requireAuth, requireModule('website'), async (req: Request, res: Response) => {
  const parsed = slugSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const taken = await Account.findOne({ websiteSlug: parsed.data.slug, _id: { $ne: req.auth!.accountId } });
  if (taken) return res.status(409).json({ error: 'slug_taken' });
  const account = await Account.findByIdAndUpdate(
    req.auth!.accountId,
    { websiteSlug: parsed.data.slug },
    { new: true },
  );
  if (!account) return res.status(404).json({ error: 'not_found' });
  return res.json({ slug: account.websiteSlug, url: `/site/${account.websiteSlug}` });
});

/** Public site data — no auth; capture form on the site POSTs to /webhook/lead/:accountId. */
websiteRouter.get('/public/:slug', async (req: Request, res: Response) => {
  const account = await Account.findOne({ websiteSlug: req.params.slug })
    .select('_id name ownerName locale phone')
    .lean();
  if (!account) return res.status(404).json({ error: 'not_found' });
  return res.json({
    accountId: String(account._id),
    name: account.name,
    ownerName: account.ownerName,
    locale: account.locale,
    webhookUrl: `/webhook/lead/${String(account._id)}`,
  });
});
