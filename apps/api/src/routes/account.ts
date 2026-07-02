import { Router, type Request, type Response } from 'express';
import { apify, getLLM, instagram, resend, stripe, twilio, video, whatsapp } from '@truecode/integrations';
import { getVoiceProvider } from '@truecode/voice';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { Account, Compliance, User } from '../models.js';
import { publicAccount, publicUser } from './auth.js';

export const accountRouter = Router();
accountRouter.use(requireAuth);

accountRouter.get('/me', async (req: Request, res: Response) => {
  const [user, account] = await Promise.all([
    User.findById(req.auth!.userId),
    Account.findById(req.auth!.accountId),
  ]);
  if (!user || !account) return res.status(404).json({ error: 'not_found' });
  return res.json({ user: publicUser(user), account: publicAccount(account.toObject()) });
});

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  phone: z.string().max(20).optional(),
  timezone: z.string().max(60).optional(),
  locale: z.enum(['en', 'es', 'ar', 'pt', 'ht']).optional(),
  ownerName: z.string().max(120).optional(),
});

accountRouter.patch('/me', async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const account = await Account.findByIdAndUpdate(req.auth!.accountId, parsed.data, { new: true });
  if (!account) return res.status(404).json({ error: 'not_found' });
  return res.json({ account: publicAccount(account.toObject()) });
});

/** Provider status board — powers the "Needs API key" badges in Settings. */
accountRouter.get('/providers', async (_req: Request, res: Response) => {
  const voice = getVoiceProvider();
  res.json({
    providers: [
      twilio.info,
      whatsapp.info,
      resend.info,
      getLLM().info,
      stripe.info,
      apify.info,
      instagram.info,
      video.info,
      { name: `Voice (${voice.name})`, live: voice.live, reason: voice.reason },
    ],
  });
});

const complianceSchema = z.object({
  tcpaConsent: z.boolean().optional(),
  quietHours: z.object({ start: z.number().min(0).max(23), end: z.number().min(1).max(24) }).optional(),
  addDnc: z.string().max(30).optional(),
  removeDnc: z.string().max(30).optional(),
});

accountRouter.get('/compliance', async (req: Request, res: Response) => {
  const doc = await Compliance.findOne({ accountId: req.auth!.accountId }).lean();
  res.json({ compliance: doc });
});

accountRouter.patch('/compliance', async (req: Request, res: Response) => {
  const parsed = complianceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const { addDnc, removeDnc, ...rest } = parsed.data;
  const update: Record<string, unknown> = { ...rest };
  const doc = await Compliance.findOneAndUpdate(
    { accountId: req.auth!.accountId },
    {
      ...(Object.keys(update).length ? { $set: update } : {}),
      ...(addDnc ? { $addToSet: { dncList: addDnc } } : {}),
      ...(removeDnc ? { $pull: { dncList: removeDnc } } : {}),
    },
    { new: true, upsert: true },
  ).lean();
  return res.json({ compliance: doc });
});
