import { Router, type Request, type Response } from 'express';
import { ledgerEntrySchema, summarizeLedger, type LedgerType } from '@truecode/shared';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { LedgerEntry } from '../models.js';

export const ledgerRouter = Router();
ledgerRouter.use(requireAuth, requireModule('ledger'), rbacWrite);

ledgerRouter.get('/summary', async (req: Request, res: Response) => {
  const entries = await LedgerEntry.find({ accountId: req.auth!.accountId }).select('type category amount date').lean();
  const summary = summarizeLedger(
    entries.map((e) => ({ type: e.type as LedgerType, category: e.category as string, amount: Number(e.amount), date: new Date(e.date as Date).toISOString() })),
  );
  res.json({ summary });
});

ledgerRouter.get('/', async (req: Request, res: Response) => {
  const type = req.query.type as string | undefined;
  const filter: Record<string, unknown> = { accountId: req.auth!.accountId };
  if (type === 'income' || type === 'expense') filter.type = type;
  const items = await LedgerEntry.find(filter).sort({ date: -1 }).limit(500).lean();
  res.json({ items });
});

ledgerRouter.post('/', async (req: Request, res: Response) => {
  const parsed = ledgerEntrySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  const entry = await LedgerEntry.create({
    accountId: req.auth!.accountId, type: d.type, category: d.category, description: d.description,
    amount: d.amount, date: new Date(d.date), dealId: d.dealId || undefined,
  });
  return res.status(201).json({ entry });
});

ledgerRouter.delete('/:id', async (req: Request, res: Response) => {
  const entry = await LedgerEntry.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!entry) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});
