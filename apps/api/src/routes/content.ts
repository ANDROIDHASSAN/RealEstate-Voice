import { Router, type Request, type Response } from 'express';
import {
  adCampaignSchema,
  adResearchSchema,
  BEST_TIMES,
  composerGenerateSchema,
  composerPostSchema,
  connectPlatformSchema,
  contentPostSchema,
  FORMAT_SPECS,
  generateCaptionSchema,
  generateImageSchema,
  mediaAssetCreateSchema,
  PLATFORM_META,
  SOCIAL_PLATFORMS,
  type AspectRatio,
  type GeneratedPost,
  type SocialPlatform,
} from '@truecode/shared';
import {
  facebook,
  getLLM,
  instagram,
  metaAdLibrary,
  metaAds,
  storage,
  video,
  youtube,
} from '@truecode/integrations';
import { z } from 'zod';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { requireApproval } from '../lib/approvals.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import {
  Account,
  AdCampaign,
  AdResearch,
  CompetitorAd,
  ContentPost,
  MediaAsset,
  SocialConnection,
  UsageLedger,
  VideoJob,
} from '../models.js';

export const contentRouter = Router();
contentRouter.use(requireAuth);

const acct = (req: Request) => req.auth!.accountId;
const meterTokens = (accountId: string, raw: string) =>
  UsageLedger.create({ accountId, type: 'aiTokens', quantity: Math.ceil(raw.length / 4) });

// ─────────────────────────────────────────────────────────────────────────────
// M8 — AI caption generation (legacy simple endpoint; fully live with an LLM key)
// ─────────────────────────────────────────────────────────────────────────────
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
  await meterTokens(acct(req), raw);
  return res.json({ captions, provider: llm.info });
});

// ─────────────────────────────────────────────────────────────────────────────
// Composer — structured multi-variant generation (hook + caption + hashtags + CTA)
// ─────────────────────────────────────────────────────────────────────────────
function normalizePost(x: Record<string, unknown>): GeneratedPost {
  const tags = Array.isArray(x.hashtags) ? x.hashtags.map((t) => String(t).replace(/^#/, '')) : [];
  return {
    hook: String(x.hook ?? ''),
    caption: String(x.caption ?? ''),
    hashtags: tags,
    firstComment: String(x.firstComment ?? (tags.length ? tags.map((t) => `#${t}`).join(' ') : '')),
    cta: String(x.cta ?? ''),
  };
}

function genFallback(input: {
  topic: string;
  tone: string;
  platform: SocialPlatform;
  variants: number;
  includeHashtags: boolean;
  includeCta: boolean;
}): GeneratedPost[] {
  const hooks = [
    `Just hit the market: ${input.topic} 👀`,
    `You won't believe this ${input.topic} 🏡`,
    `Your next move starts here — ${input.topic}`,
    `Dreaming of ${input.topic}? Let's make it real.`,
  ];
  const ctas = ['DM us to book a tour.', 'Tap the link to see more.', 'Call today — homes here move fast.', 'Comment "INFO" and we\'ll reach out.'];
  const tagBank = ['RealEstate', 'DreamHome', 'JustListed', 'Realtor', 'HomeGoals', 'ForSale', 'OpenHouse', 'HouseHunting', 'NewListing', 'LuxuryHomes'];
  return Array.from({ length: input.variants }, (_, i) => {
    const tags = input.includeHashtags ? tagBank.slice(i % 4, (i % 4) + 6) : [];
    return {
      hook: hooks[i % hooks.length]!,
      caption: `(${input.tone}) ${input.topic} — a standout opportunity you don't want to miss. Thoughtfully priced and move-in ready.${input.includeCta ? ` ${ctas[i % ctas.length]!}` : ''}`,
      hashtags: tags,
      firstComment: tags.map((t) => `#${t}`).join(' '),
      cta: ctas[i % ctas.length]!,
    };
  });
}

contentRouter.post('/generate', requireModule('content'), async (req: Request, res: Response) => {
  const parsed = composerGenerateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  const llm = getLLM();
  const prompt =
    `You are a top-performing real-estate social media strategist. Create ${d.variants} distinct ${d.platform} ` +
    `${FORMAT_SPECS[d.format].label} variants about: "${d.topic}".` +
    `${d.listingDetails ? ` Listing details: ${d.listingDetails}.` : ''} Language: ${d.locale}. Tone: ${d.tone}. Goal: ${d.goal}.\n` +
    `Return ONLY a JSON array; each item: {"hook": string, "caption": string, "hashtags": string[], "firstComment": string, "cta": string}.\n` +
    `${d.includeHook ? 'hook = a 1-line scroll-stopper.' : 'hook = "".'} caption = 2-4 sentences` +
    `${d.includeCta ? ' ending with a clear call-to-action' : ''}. ` +
    `${d.includeHashtags ? 'hashtags = 6-10 relevant tags WITHOUT the # sign; also fill firstComment with them prefixed by #.' : 'hashtags = [].'}`;
  const raw = await llm.complete(prompt, { json: true, maxTokens: 1400 });
  let posts: GeneratedPost[];
  try {
    const j = JSON.parse(raw) as unknown;
    posts = (Array.isArray(j) ? j : []).slice(0, d.variants).map((x) => normalizePost(x as Record<string, unknown>));
    if (!posts.length || posts.every((p) => !p.caption)) throw new Error('empty');
  } catch {
    posts = genFallback(d);
  }
  await meterTokens(acct(req), raw);
  return res.json({ posts, provider: llm.info });
});

// ─────────────────────────────────────────────────────────────────────────────
// AI image generation (mock returns a labeled placeholder asset)
// ─────────────────────────────────────────────────────────────────────────────
const ASPECT_DIMS: Record<AspectRatio, [number, number]> = {
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
};
contentRouter.post('/generate-image', requireModule('content'), async (req: Request, res: Response) => {
  const parsed = generateImageSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { prompt, aspect, style } = parsed.data;
  const [w, h] = ASPECT_DIMS[aspect];
  // No image-gen key wired yet → labeled placeholder (never fake-photoreal).
  const url = `https://placehold.co/${w}x${h}/E6DDF8/1A1A1A?text=${encodeURIComponent(`${style}: ${prompt.slice(0, 40)}`)}`;
  const asset = await MediaAsset.create({
    accountId: acct(req),
    name: prompt.slice(0, 80),
    kind: 'image',
    url,
    thumbnailUrl: url,
    aspect,
    width: w,
    height: h,
    source: 'ai-generated',
    stub: true,
    tags: ['ai', style],
  });
  return res.status(201).json({ asset, stub: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Compose — create a multi-platform post and queue publishing
// ─────────────────────────────────────────────────────────────────────────────
contentRouter.post('/compose', requireModule('content'), async (req: Request, res: Response) => {
  const parsed = composerPostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  const assets = d.mediaAssetIds.length
    ? await MediaAsset.find({ accountId: acct(req), _id: { $in: d.mediaAssetIds } }).select('url').lean()
    : [];
  const mediaUrls = [...d.mediaUrls, ...assets.map((a) => a.url)].filter(Boolean);
  const scheduledAt = d.publishNow ? new Date() : new Date(d.scheduledAt!);
  const spec = FORMAT_SPECS[d.format];
  const post = await ContentPost.create({
    accountId: acct(req),
    platforms: d.platforms,
    channel: d.platforms[0],
    type: spec.aspect === '9:16' ? (d.format === 'story' ? 'story' : 'reel') : 'post',
    format: d.format,
    title: d.title,
    caption: d.caption,
    firstComment: d.firstComment,
    mediaUrls,
    mediaUrl: mediaUrls[0],
    mediaAssetIds: d.mediaAssetIds,
    scheduledAt,
    status: 'scheduled',
  });
  const delayMs = Math.max(0, scheduledAt.getTime() - Date.now());
  await getQueue().enqueue(QUEUES.contentPublish, { postId: String(post._id) }, { delayMs, jobId: `pub_${post._id}` });
  return res.status(201).json({ post });
});

/** Calendar feed — all posts across platforms (content-gated, not IG-gated). */
contentRouter.get('/calendar', requireModule('content'), async (req: Request, res: Response) => {
  const items = await ContentPost.find({ accountId: acct(req) }).sort({ scheduledAt: -1 }).limit(300).lean();
  res.json({ items, provider: { instagram: instagram.info, facebook: facebook.info, youtube: youtube.info } });
});

/** Reschedule / cancel a post. */
contentRouter.patch('/posts/:id', requireModule('content'), async (req: Request, res: Response) => {
  const body = z.object({ scheduledAt: z.string().datetime().optional(), status: z.enum(['draft', 'scheduled']).optional() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_input' });
  const post = await ContentPost.findOne({ _id: req.params.id, accountId: acct(req) });
  if (!post) return res.status(404).json({ error: 'not_found' });
  if (body.data.scheduledAt) post.scheduledAt = new Date(body.data.scheduledAt);
  if (body.data.status) post.status = body.data.status;
  await post.save();
  if (post.status === 'scheduled') {
    const delayMs = Math.max(0, post.scheduledAt.getTime() - Date.now());
    await getQueue().enqueue(QUEUES.contentPublish, { postId: String(post._id) }, { delayMs, jobId: `pub_${post._id}_${post.scheduledAt.getTime()}` });
  }
  res.json({ post });
});

contentRouter.delete('/posts/:id', requireModule('content'), async (req: Request, res: Response) => {
  await ContentPost.deleteOne({ _id: req.params.id, accountId: acct(req) });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// M6 — legacy Instagram scheduler (kept for backward compat)
// ─────────────────────────────────────────────────────────────────────────────
contentRouter.get('/posts', requireModule('instagram'), async (req: Request, res: Response) => {
  const items = await ContentPost.find({ accountId: acct(req) }).sort({ scheduledAt: 1 }).limit(200).lean();
  res.json({ items, provider: instagram.info });
});

contentRouter.post('/posts', requireModule('instagram'), async (req: Request, res: Response) => {
  const parsed = contentPostSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const post = await ContentPost.create({
    accountId: acct(req),
    ...parsed.data,
    scheduledAt: new Date(parsed.data.scheduledAt),
    status: 'scheduled',
  });
  const delayMs = Math.max(0, new Date(parsed.data.scheduledAt).getTime() - Date.now());
  await getQueue().enqueue(QUEUES.contentPublish, { postId: String(post._id) }, { delayMs, jobId: `pub_${post._id}` });
  return res.status(201).json({ post });
});

// ─────────────────────────────────────────────────────────────────────────────
// Media library
// ─────────────────────────────────────────────────────────────────────────────
function aspectFrom(w?: number, h?: number, given?: AspectRatio): AspectRatio | 'other' {
  if (given) return given;
  if (!w || !h) return 'other';
  const r = w / h;
  if (Math.abs(r - 1) < 0.05) return '1:1';
  if (Math.abs(r - 4 / 5) < 0.05) return '4:5';
  if (Math.abs(r - 9 / 16) < 0.05) return '9:16';
  if (Math.abs(r - 16 / 9) < 0.05) return '16:9';
  return 'other';
}

contentRouter.get('/media', requireModule('content'), async (req: Request, res: Response) => {
  const items = await MediaAsset.find({ accountId: acct(req) }).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ items, provider: storage.info });
});

contentRouter.post('/media', requireModule('content'), async (req: Request, res: Response) => {
  const parsed = mediaAssetCreateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  let url = d.url ?? '';
  let stub = false;
  if (d.dataBase64) {
    const saved = await storage.save({ name: d.name, contentType: d.contentType ?? (d.kind === 'video' ? 'video/mp4' : 'image/jpeg'), dataBase64: d.dataBase64 });
    url = saved.url;
    stub = saved.stub;
  }
  const asset = await MediaAsset.create({
    accountId: acct(req),
    name: d.name,
    kind: d.kind,
    url,
    thumbnailUrl: d.kind === 'image' ? url : undefined,
    aspect: aspectFrom(d.width, d.height, d.aspect),
    width: d.width,
    height: d.height,
    durationSec: d.durationSec,
    sizeBytes: d.sizeBytes,
    tags: d.tags,
    source: d.source,
    stub,
  });
  res.status(201).json({ asset });
});

contentRouter.delete('/media/:id', requireModule('content'), async (req: Request, res: Response) => {
  await MediaAsset.deleteOne({ _id: req.params.id, accountId: acct(req) });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Social connections
// ─────────────────────────────────────────────────────────────────────────────
function providerInfoFor(platform: SocialPlatform) {
  switch (platform) {
    case 'instagram': return instagram.info;
    case 'facebook': return facebook.info;
    case 'youtube': return youtube.info;
    default: return { name: platform, live: false, reason: 'Adapter pending — connect via OAuth' };
  }
}

contentRouter.get('/connections', requireModule('content'), async (req: Request, res: Response) => {
  const docs = await SocialConnection.find({ accountId: acct(req) }).lean();
  const byPlatform = new Map(docs.map((d) => [d.platform, d]));
  const items = SOCIAL_PLATFORMS.map((platform) => {
    const info = providerInfoFor(platform);
    const doc = byPlatform.get(platform);
    const status = doc?.status ?? (info.live ? 'connected' : 'disconnected');
    return {
      platform,
      label: PLATFORM_META[platform].label,
      color: PLATFORM_META[platform].color,
      status,
      live: info.live,
      reason: info.reason,
      displayName: doc?.displayName,
      connectedAt: doc?.connectedAt,
      stub: !info.live,
    };
  });
  res.json({ items });
});

contentRouter.post('/connections', requireModule('content'), async (req: Request, res: Response) => {
  const parsed = connectPlatformSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { platform, displayName, externalId } = parsed.data;
  const info = providerInfoFor(platform);
  const status = info.live ? 'connected' : 'pending';
  const doc = await SocialConnection.findOneAndUpdate(
    { accountId: acct(req), platform },
    {
      $set: {
        status,
        displayName: displayName ?? PLATFORM_META[platform].label,
        externalId,
        connectedAt: new Date(),
        stub: !info.live,
        reason: info.reason,
      },
    },
    { new: true, upsert: true },
  );
  res.json({ connection: doc, live: info.live, reason: info.reason });
});

contentRouter.delete('/connections/:platform', requireModule('content'), async (req: Request, res: Response) => {
  await SocialConnection.findOneAndUpdate(
    { accountId: acct(req), platform: req.params.platform },
    { $set: { status: 'disconnected', connectedAt: null } },
  );
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// M8 — video render request (working queue + [STUB] render adapter)
// ─────────────────────────────────────────────────────────────────────────────
const videoSchema = z.object({ title: z.string().min(2).max(140), script: z.string().min(2).max(4000) });

contentRouter.get('/videos', requireModule('content'), async (req: Request, res: Response) => {
  const items = await VideoJob.find({ accountId: acct(req) }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items, provider: video.info });
});

contentRouter.post('/videos', requireModule('content'), async (req: Request, res: Response) => {
  const parsed = videoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const job = await VideoJob.create({ accountId: acct(req), ...parsed.data });
  await getQueue().enqueue(QUEUES.videoRender, { jobId: String(job._id) });
  return res.status(202).json({ job });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ads Manager (Meta Marketing API adapter)
// ─────────────────────────────────────────────────────────────────────────────
contentRouter.get('/ads', requireModule('ads'), async (req: Request, res: Response) => {
  const items = await AdCampaign.find({ accountId: acct(req) }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ items, provider: metaAds.info });
});

contentRouter.post('/ads', requireModule('ads'), async (req: Request, res: Response) => {
  const parsed = adCampaignSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  const campaign = await AdCampaign.create({
    accountId: acct(req),
    name: d.name,
    objective: d.objective,
    platform: d.platform,
    status: 'draft',
    budgetDaily: d.budgetDaily,
    durationDays: d.durationDays,
    startAt: d.startAt ? new Date(d.startAt) : undefined,
    creative: d.creative,
    fromPostId: d.fromPostId,
    targeting: d.targeting,
  });

  // Launching an ad spends real budget — gate it if the account requires sign-off.
  const gate = await requireApproval({
    accountId: acct(req),
    action: 'ad_launch',
    title: `Launch ad: ${d.name}`,
    summary: `$${d.budgetDaily}/day × ${d.durationDays ?? 7} days on ${d.platform}`,
    payload: { campaignId: String(campaign._id) },
    requestedBy: req.auth!.userId,
    origin: 'content/ads',
  });
  if (gate.gated) {
    campaign.status = 'pending_review';
    await campaign.save();
    return res.status(202).json({ campaign, pendingApproval: true, approvalId: gate.approvalId, provider: metaAds.info });
  }

  await getQueue().enqueue(QUEUES.adLaunch, { campaignId: String(campaign._id) });
  res.status(201).json({ campaign, provider: metaAds.info });
});

contentRouter.post('/ads/:id/sync', requireModule('ads'), async (req: Request, res: Response) => {
  const campaign = await AdCampaign.findOne({ _id: req.params.id, accountId: acct(req) });
  if (!campaign) return res.status(404).json({ error: 'not_found' });
  await getQueue().enqueue(QUEUES.adSync, { campaignId: String(campaign._id) });
  res.json({ ok: true });
});

contentRouter.post('/ads/:id/status', requireModule('ads'), async (req: Request, res: Response) => {
  const body = z.object({ status: z.enum(['active', 'paused', 'completed']) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_input' });
  const campaign = await AdCampaign.findOneAndUpdate(
    { _id: req.params.id, accountId: acct(req) },
    { $set: { status: body.data.status } },
    { new: true },
  );
  if (!campaign) return res.status(404).json({ error: 'not_found' });
  res.json({ campaign });
});

// ─────────────────────────────────────────────────────────────────────────────
// Market Research — Meta Ad Library competitor intelligence
// ─────────────────────────────────────────────────────────────────────────────
contentRouter.get('/research', requireModule('ads'), async (req: Request, res: Response) => {
  const [runs, watched] = await Promise.all([
    AdResearch.find({ accountId: acct(req) }).sort({ createdAt: -1 }).limit(20).lean(),
    CompetitorAd.find({ accountId: acct(req), watched: true }).sort({ createdAt: -1 }).limit(50).lean(),
  ]);
  res.json({ runs, watched, provider: metaAdLibrary.info });
});

contentRouter.post('/research', requireModule('ads'), async (req: Request, res: Response) => {
  const parsed = adResearchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const d = parsed.data;
  const { items, stub } = await metaAdLibrary.search(d);
  const run = await AdResearch.create({
    accountId: acct(req),
    query: d.query,
    region: d.region,
    platform: d.platform,
    count: items.length,
    stub,
    provider: metaAdLibrary.info,
  });
  const docs = await CompetitorAd.insertMany(
    items.map((a) => ({
      accountId: acct(req),
      researchId: run._id,
      advertiser: a.advertiser,
      page: a.page,
      platform: a.platform,
      headline: a.headline,
      primaryText: a.primaryText,
      cta: a.cta,
      mediaType: a.mediaType,
      thumbnailUrl: a.thumbnailUrl,
      startedRunning: new Date(a.startedRunning),
      daysRunning: a.daysRunning,
      estimatedSpend: a.estimatedSpend,
      impressionsRange: a.impressionsRange,
      angle: a.angle,
      sourceUrl: a.sourceUrl,
    })),
  );
  res.status(201).json({ run, items: docs, provider: metaAdLibrary.info, stub });
});

contentRouter.get('/research/:id/ads', requireModule('ads'), async (req: Request, res: Response) => {
  const items = await CompetitorAd.find({ accountId: acct(req), researchId: req.params.id }).sort({ daysRunning: -1 }).lean();
  res.json({ items });
});

contentRouter.post('/research/ads/:id/watch', requireModule('ads'), async (req: Request, res: Response) => {
  const body = z.object({ watched: z.boolean() }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'invalid_input' });
  const ad = await CompetitorAd.findOneAndUpdate(
    { _id: req.params.id, accountId: acct(req) },
    { $set: { watched: body.data.watched } },
    { new: true },
  );
  if (!ad) return res.status(404).json({ error: 'not_found' });
  res.json({ ad });
});

// ─────────────────────────────────────────────────────────────────────────────
// Studio overview — header stats + posting cadence + best times
// ─────────────────────────────────────────────────────────────────────────────
contentRouter.get('/overview', requireModule('content'), async (req: Request, res: Response) => {
  const accountId = acct(req);
  const [posts, connections, campaigns, mediaCount, watchedCount] = await Promise.all([
    ContentPost.find({ accountId }).select('status platforms scheduledAt').lean(),
    SocialConnection.find({ accountId, status: 'connected' }).select('platform').lean(),
    AdCampaign.find({ accountId }).select('status metrics').lean(),
    MediaAsset.countDocuments({ accountId }),
    CompetitorAd.countDocuments({ accountId, watched: true }),
  ]);
  const now = Date.now();
  const scheduled = posts.filter((p) => p.status === 'scheduled' && new Date(p.scheduledAt).getTime() > now).length;
  const published = posts.filter((p) => p.status === 'published' || p.status === 'stub-published').length;
  const activeCampaigns = campaigns.filter((c) => c.status === 'active' || c.status === 'pending_review').length;
  const totalSpend = campaigns.reduce((a, c) => a + (c.metrics?.spend ?? 0), 0);
  const totalLeads = campaigns.reduce((a, c) => a + (c.metrics?.leads ?? 0), 0);

  // Cadence: posts per weekday (for a bar chart).
  const cadence = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, posts: 0 }));
  for (const p of posts) {
    const wd = (new Date(p.scheduledAt).getDay() + 6) % 7; // Mon=0
    cadence[wd]!.posts += 1;
  }

  // Platform mix (for a donut).
  const mix = SOCIAL_PLATFORMS.map((platform) => ({
    platform,
    label: PLATFORM_META[platform].label,
    count: posts.filter((p) => (p.platforms ?? ['instagram']).includes(platform)).length,
  })).filter((m) => m.count > 0);

  const connected = connections.map((c) => c.platform) as SocialPlatform[];
  const bestTimes = (connected.length ? connected : (['instagram'] as SocialPlatform[])).flatMap((p) =>
    BEST_TIMES[p].map((t) => ({ platform: p, ...t })),
  );

  res.json({
    stats: { scheduled, published, activeCampaigns, mediaCount, connections: connections.length, totalSpend, totalLeads, watchedCount },
    cadence,
    mix,
    bestTimes,
  });
});
