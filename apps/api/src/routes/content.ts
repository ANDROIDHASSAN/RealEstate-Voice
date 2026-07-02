import { Router, type Request, type Response } from 'express';
import { contentPostSchema, generateCaptionSchema } from '@truecode/shared';
import { getLLM, instagram, video } from '@truecode/integrations';
import { z } from 'zod';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { ContentPost, UsageLedger, VideoJob } from '../models.js';

export const contentRouter = Router();
contentRouter.use(requireAuth);

/** M8 — AI caption generation (fully live when an LLM key is set). */
contentRouter.post('/captions', requireModule('content'), async (req: Request, res: Response) => {
  const parsed = generateCaptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { topic, locale, tone, count } = parsed.data;
  const llm = getLLM();
  const raw = await llm.complete(
    `Write ${count} distinct Instagram captions for a real-estate agent about: "${topic}". Language: ${locale}. Tone: ${tone}. Each caption: 1-3 sentences + 4-6 relevant hashtags. Return as a JSON array of strings.`,
    { json: true, maxTokens: 800 },
  );
  let captions: string[];
  try {
    const parsedJson = JSON.parse(raw) as unknown;
    captions = Array.isArray(parsedJson)
      ? parsedJson.map(String)
      : [`(Mock caption — add an LLM key for live generation) 🏡 ${topic} — DM us to learn more! #RealEstate #DreamHome #JustListed #Realtor`];
  } catch {
    captions = raw.split('\n').filter((l) => l.trim().length > 10).slice(0, count);
  }
  await UsageLedger.create({ accountId: req.auth!.accountId, type: 'aiTokens', quantity: Math.ceil(raw.length / 4) });
  return res.json({ captions, provider: llm.info });
});

/** M6 — Instagram scheduler (UI live; publish via [STUB] adapter until Meta review). */
contentRouter.get('/posts', requireModule('instagram'), async (req: Request, res: Response) => {
  const items = await ContentPost.find({ accountId: req.auth!.accountId }).sort({ scheduledAt: 1 }).limit(200).lean();
  res.json({ items, provider: instagram.info });
});

contentRouter.post('/posts', requireModule('instagram'), async (req: Request, res: Response) => {
  const parsed = contentPostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const post = await ContentPost.create({
    accountId: req.auth!.accountId,
    ...parsed.data,
    scheduledAt: new Date(parsed.data.scheduledAt),
    status: 'scheduled',
  });
  const delayMs = Math.max(0, new Date(parsed.data.scheduledAt).getTime() - Date.now());
  await getQueue().enqueue(QUEUES.contentPublish, { postId: String(post._id) }, { delayMs, jobId: `pub_${post._id}` });
  return res.status(201).json({ post });
});

/** M8 — video render request (working queue + [STUB] render adapter). */
const videoSchema = z.object({ title: z.string().min(2).max(140), script: z.string().min(2).max(4000) });

contentRouter.get('/videos', requireModule('content'), async (req: Request, res: Response) => {
  const items = await VideoJob.find({ accountId: req.auth!.accountId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items, provider: video.info });
});

contentRouter.post('/videos', requireModule('content'), async (req: Request, res: Response) => {
  const parsed = videoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const job = await VideoJob.create({ accountId: req.auth!.accountId, ...parsed.data });
  await getQueue().enqueue(QUEUES.videoRender, { jobId: String(job._id) });
  return res.status(202).json({ job });
});
