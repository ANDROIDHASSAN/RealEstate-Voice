import { Router, type Request, type Response } from 'express';
import { scrapeJobSchema } from '@truecode/shared';
import { apify } from '@truecode/integrations';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { ScrapeJob } from '../models.js';

export const leadEngineRouter = Router();
leadEngineRouter.use(requireAuth, requireModule('leadEngine'));

leadEngineRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ provider: apify.info });
});

leadEngineRouter.get('/jobs', async (req: Request, res: Response) => {
  const items = await ScrapeJob.find({ accountId: req.auth!.accountId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items });
});

/** M5: scrape → enrich → import as leads → (optionally) cold campaign. */
leadEngineRouter.post('/jobs', async (req: Request, res: Response) => {
  const parsed = scrapeJobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const job = await ScrapeJob.create({ accountId: req.auth!.accountId, ...parsed.data });
  await getQueue().enqueue(QUEUES.scrape, { jobId: String(job._id) });
  return res.status(202).json({ job });
});
