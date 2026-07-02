import { Router, type Request, type Response } from 'express';
import { DEAL_STAGES, dealCommission, dealInputSchema, moveDealSchema, STAGE_PROBABILITY, type DealStage } from '@truecode/shared';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { Deal } from '../models.js';

export const dealsRouter = Router();
dealsRouter.use(requireAuth, requireModule('deals'), rbacWrite);

const toDate = (s?: string) => (s ? new Date(s) : undefined);

dealsRouter.get('/stats', async (req: Request, res: Response) => {
  const items = await Deal.find({ accountId: req.auth!.accountId }).select('stage value commissionPct').lean();
  const byStage = Object.fromEntries(DEAL_STAGES.map((s) => [s, 0])) as Record<DealStage, number>;
  let pipelineValue = 0;
  let weightedValue = 0;
  let wonCommission = 0;
  for (const d of items) {
    const stage = d.stage as DealStage;
    byStage[stage] += 1;
    const value = Number(d.value ?? 0);
    if (stage !== 'closed-lost') pipelineValue += value;
    weightedValue += value * (STAGE_PROBABILITY[stage] ?? 0);
    if (stage === 'closed-won') wonCommission += dealCommission(value, Number(d.commissionPct ?? 0));
  }
  res.json({
    total: items.length,
    byStage,
    pipelineValue: Math.round(pipelineValue),
    weightedValue: Math.round(weightedValue),
    wonCommission: Math.round(wonCommission),
  });
});

dealsRouter.get('/', async (req: Request, res: Response) => {
  const items = await Deal.find({ accountId: req.auth!.accountId }).sort({ updatedAt: -1 }).limit(300).lean();
  res.json({ items });
});

dealsRouter.get('/:id', async (req: Request, res: Response) => {
  const deal = await Deal.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!deal) return res.status(404).json({ error: 'not_found' });
  return res.json({ deal });
});

dealsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = dealInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  const deal = await Deal.create({
    accountId: req.auth!.accountId, createdBy: req.auth!.userId, title: d.title, clientName: d.clientName,
    propertyAddress: d.propertyAddress, side: d.side, stage: d.stage, value: d.value, commissionPct: d.commissionPct,
    expectedCloseDate: toDate(d.expectedCloseDate), leadId: d.leadId || undefined, notes: d.notes,
    tasks: d.tasks.map((t) => ({ title: t.title, done: t.done, dueDate: toDate(t.dueDate) })),
    closedAt: d.stage.startsWith('closed') ? new Date() : undefined,
  });
  return res.status(201).json({ deal });
});

dealsRouter.put('/:id', async (req: Request, res: Response) => {
  const parsed = dealInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const deal = await Deal.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!deal) return res.status(404).json({ error: 'not_found' });
  const d = parsed.data;
  Object.assign(deal, {
    title: d.title, clientName: d.clientName, propertyAddress: d.propertyAddress, side: d.side, stage: d.stage,
    value: d.value, commissionPct: d.commissionPct, expectedCloseDate: toDate(d.expectedCloseDate),
    notes: d.notes, tasks: d.tasks.map((t) => ({ title: t.title, done: t.done, dueDate: toDate(t.dueDate) })),
    closedAt: d.stage.startsWith('closed') ? deal.closedAt ?? new Date() : undefined,
  });
  await deal.save();
  return res.json({ deal });
});

/** PATCH /:id/stage — drag-and-drop stage move on the Kanban board. */
dealsRouter.patch('/:id/stage', async (req: Request, res: Response) => {
  const parsed = moveDealSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const deal = await Deal.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!deal) return res.status(404).json({ error: 'not_found' });
  deal.stage = parsed.data.stage;
  deal.closedAt = parsed.data.stage.startsWith('closed') ? new Date() : undefined;
  await deal.save();
  if (parsed.data.stage === 'closed-won') {
    emitAgentEvent(req.auth!.accountId, {
      type: 'agent:done', agentKey: 'deals',
      title: `Deal won: ${deal.title}`,
      detail: `Est. commission $${dealCommission(deal.value, deal.commissionPct).toLocaleString()}`,
      status: 'done',
    });
  }
  return res.json({ deal });
});

dealsRouter.delete('/:id', async (req: Request, res: Response) => {
  const deal = await Deal.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!deal) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});
