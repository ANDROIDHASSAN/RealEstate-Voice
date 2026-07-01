import { Router, type Request, type Response } from 'express';
import { triggerCallSchema, VOICE_AGENTS } from '@closeflow/shared';
import { getQueue, QUEUES } from '../lib/queue.js';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { Call, Lead } from '../models.js';

export const callsRouter = Router();
callsRouter.use(requireAuth, requireModule('voice'));

callsRouter.get('/agents', (_req: Request, res: Response) => {
  res.json({ agents: VOICE_AGENTS });
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
