import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { sendOutbound } from '../lib/outbound.js';
import { Conversation } from '../models.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

conversationsRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 100));
  const items = await Conversation.find({ accountId: req.auth!.accountId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .populate('leadId', 'firstName lastName phone locale')
    .lean();
  res.json({ items });
});

const replySchema = z.object({ text: z.string().min(1).max(2000) });

/** Human reply from the dashboard — still goes through the outbound gateway. */
conversationsRouter.post('/:id/reply', async (req: Request, res: Response) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const conversation = await Conversation.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!conversation) return res.status(404).json({ error: 'not_found' });
  if (conversation.channel === 'instagram')
    return res.status(400).json({ error: 'instagram_dm_pending_meta_review' });
  const result = await sendOutbound({
    accountId: req.auth!.accountId,
    leadId: String(conversation.leadId),
    channel: conversation.channel as 'sms' | 'whatsapp' | 'email',
    text: parsed.data.text,
    meta: { kind: 'human-reply', userId: req.auth!.userId },
  });
  conversation.status = 'human';
  await conversation.save();
  return res.json({ result });
});
