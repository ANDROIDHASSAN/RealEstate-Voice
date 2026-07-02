import { Router, type Request, type Response } from 'express';
import { createLeadSchema } from '@truecode/shared';
import { z } from 'zod';
import { getQueue, QUEUES } from '../lib/queue.js';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { Lead } from '../models.js';

export const leadsRouter = Router();
leadsRouter.use(requireAuth, rbacWrite);

const listQuery = z.object({
  status: z.string().optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
});

leadsRouter.get('/', async (req: Request, res: Response) => {
  const q = listQuery.parse(req.query);
  const filter: Record<string, unknown> = { accountId: req.auth!.accountId };
  if (q.status) filter.status = q.status;
  if (q.search) {
    filter.$or = [
      { firstName: { $regex: q.search, $options: 'i' } },
      { lastName: { $regex: q.search, $options: 'i' } },
      { phone: { $regex: q.search.replace(/[^\d+]/g, '') || q.search } },
      { email: { $regex: q.search, $options: 'i' } },
    ];
  }
  const [items, total] = await Promise.all([
    Lead.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Lead.countDocuments(filter),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
});

leadsRouter.get('/:id', async (req: Request, res: Response) => {
  const lead = await Lead.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!lead) return res.status(404).json({ error: 'not_found' });
  return res.json({ lead });
});

/** Manual lead creation — flows through the same instant-reply pipeline. */
leadsRouter.post('/', requireModule('instantReply'), async (req: Request, res: Response) => {
  const parsed = createLeadSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  const lead = await Lead.create({
    accountId: req.auth!.accountId,
    firstName: d.firstName,
    lastName: d.lastName,
    phone: d.phone,
    email: d.email,
    locale: d.locale ?? 'en',
    source: 'manual',
    propertyInterest: d.propertyInterest,
    location: d.location,
    budget: d.budget,
    consent: { sms: d.consentSms, call: d.consentCall, whatsapp: d.consentSms, email: true },
  });
  await getQueue().enqueue(
    QUEUES.instantReply,
    { accountId: req.auth!.accountId, leadId: String(lead._id) },
    { jobId: `ir_${lead._id}` },
  );
  return res.status(201).json({ lead });
});

const patchSchema = z.object({
  status: z.enum(['new', 'contacted', 'qualified', 'appointment', 'nurture', 'won', 'lost', 'dnc']).optional(),
  intent: z.enum(['buyer', 'seller', 'renter', 'investor', 'unknown']).optional(),
  urgency: z.enum(['now', '1-3mo', '3-6mo', '6mo+', 'unknown']).optional(),
  budget: z.string().max(60).optional(),
  score: z.number().min(0).max(100).optional(),
});

leadsRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, accountId: req.auth!.accountId },
    parsed.data,
    { new: true },
  ).lean();
  if (!lead) return res.status(404).json({ error: 'not_found' });
  return res.json({ lead });
});
