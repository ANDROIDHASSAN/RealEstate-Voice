import { Router, type Request, type Response } from 'express';
import { createSequenceSchema } from '@closeflow/shared';
import { z } from 'zod';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { DripEnrollment, Sequence } from '../models.js';
import { enrollLead } from '../workers/drip.js';

export const sequencesRouter = Router();
sequencesRouter.use(requireAuth, requireModule('followup'));

sequencesRouter.get('/', async (req: Request, res: Response) => {
  const items = await Sequence.find({ accountId: req.auth!.accountId }).sort({ createdAt: -1 }).lean();
  res.json({ items });
});

sequencesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createSequenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const sequence = await Sequence.create({ accountId: req.auth!.accountId, ...parsed.data });
  return res.status(201).json({ sequence });
});

sequencesRouter.delete('/:id', async (req: Request, res: Response) => {
  await Sequence.deleteOne({ _id: req.params.id, accountId: req.auth!.accountId });
  await DripEnrollment.updateMany(
    { sequenceId: req.params.id, accountId: req.auth!.accountId, status: 'active' },
    { $set: { status: 'stopped' } },
  );
  res.json({ ok: true });
});

const enrollSchema = z.object({ leadId: z.string().min(1), sequenceId: z.string().min(1) });

sequencesRouter.post('/enroll', async (req: Request, res: Response) => {
  const parsed = enrollSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const enrollmentId = await enrollLead(req.auth!.accountId, parsed.data.leadId, parsed.data.sequenceId);
  if (!enrollmentId) return res.status(404).json({ error: 'sequence_not_found_or_empty' });
  return res.status(201).json({ enrollmentId });
});

sequencesRouter.get('/enrollments', async (req: Request, res: Response) => {
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit) || 200));
  const items = await DripEnrollment.find({ accountId: req.auth!.accountId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('leadId', 'firstName lastName')
    .populate('sequenceId', 'name')
    .lean();
  res.json({ items });
});
