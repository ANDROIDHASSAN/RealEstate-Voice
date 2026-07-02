import { Router, type Request, type Response } from 'express';
import { localeSchema, triggerCallSchema, VOICE_AGENTS } from '@truecode/shared';
import { getVoiceProvider } from '@truecode/voice';
import { z } from 'zod';
import { getQueue, QUEUES } from '../lib/queue.js';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { Account, Call, Lead } from '../models.js';

export const callsRouter = Router();
callsRouter.use(requireAuth, requireModule('voice'));

callsRouter.get('/agents', (_req: Request, res: Response) => {
  res.json({ agents: VOICE_AGENTS });
});

/** Test-call panel info: the number to dial IN to, and the active provider. */
callsRouter.get('/test-info', async (req: Request, res: Response) => {
  const account = await Account.findById(req.auth!.accountId).select('twilioNumber phone').lean();
  const provider = getVoiceProvider();
  const inboundNumber =
    account?.twilioNumber || (process.env.TWILIO_PHONE_NUMBER ?? '').replace(/\s+#.*$/, '').trim() || '';
  res.json({
    inboundNumber,
    provider: provider.name,
    live: provider.live,
    reason: provider.reason,
    defaultPhone: account?.phone ?? '',
  });
});

const testCallSchema = z.object({
  agentKey: z.string().min(1).max(80),
  phone: z.string().min(7).max(20),
  locale: localeSchema.optional(),
});

/**
 * Live self-test: place an outbound call to the user's OWN number so they can
 * hear the agent (real when Vapi/Dograh is configured; a simulated lifecycle
 * with transcript in mock mode). Reuses one "test" lead per account, marked
 * with full consent since the user explicitly requested the call.
 */
callsRouter.post('/test', async (req: Request, res: Response) => {
  const parsed = testCallSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const accountId = req.auth!.accountId;
  const { agentKey, phone, locale } = parsed.data;

  const lead = await Lead.findOneAndUpdate(
    { accountId, source: 'test' },
    {
      $set: {
        firstName: 'Test Call',
        lastName: '(you)',
        phone,
        locale: locale ?? 'en',
        status: 'new',
        propertyInterest: 'a test property in your area',
        consent: { sms: true, call: true, whatsapp: true, email: true },
      },
    },
    { new: true, upsert: true },
  );

  await getQueue().enqueue(
    QUEUES.voiceCall,
    { accountId, leadId: String(lead._id), agentKey, test: true },
    { jobId: `test_${lead._id}_${Date.now()}` },
  );
  return res.status(202).json({ leadId: String(lead._id), agentKey });
});

callsRouter.get('/', async (req: Request, res: Response) => {
  const items = await Call.find({ accountId: req.auth!.accountId })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate('leadId', 'firstName lastName phone locale')
    .lean();
  res.json({ items });
});

callsRouter.get('/:id', async (req: Request, res: Response) => {
  const call = await Call.findOne({ _id: req.params.id, accountId: req.auth!.accountId })
    .populate('leadId', 'firstName lastName phone locale')
    .lean();
  if (!call) return res.status(404).json({ error: 'not_found' });
  return res.json({ call });
});

/** Trigger an outbound call (M2 acceptance path). */
callsRouter.post('/trigger', async (req: Request, res: Response) => {
  const parsed = triggerCallSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const lead = await Lead.findOne({ _id: parsed.data.leadId, accountId: req.auth!.accountId });
  if (!lead) return res.status(404).json({ error: 'lead_not_found' });
  if (!lead.phone) return res.status(400).json({ error: 'lead_has_no_phone' });
  await getQueue().enqueue(QUEUES.voiceCall, {
    accountId: req.auth!.accountId,
    leadId: parsed.data.leadId,
    agentKey: parsed.data.agentKey,
  });
  return res.status(202).json({ queued: true });
});
