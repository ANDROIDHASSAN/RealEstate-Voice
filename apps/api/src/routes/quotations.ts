import { Router, type Request, type Response } from 'express';
import {
  computeTotals,
  QUOTE_STATUSES,
  QUOTE_TEMPLATES,
  quoteInputSchema,
  quoteTemplate,
  type QuoteStatus,
} from '@truecode/shared';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { Quote } from '../models.js';

export const quotationsRouter = Router();
quotationsRouter.use(requireAuth, requireModule('quotations'), rbacWrite);

/** Sequential, human-friendly quote number scoped to the account. */
async function nextNumber(accountId: string): Promise<string> {
  const count = await Quote.countDocuments({ accountId });
  const year = new Date().getUTCFullYear();
  return `QT-${year}-${String(count + 1).padStart(4, '0')}`;
}

/** GET /templates — the real-estate service catalog for the builder. */
quotationsRouter.get('/templates', (_req: Request, res: Response) => {
  res.json({ templates: QUOTE_TEMPLATES });
});

/** GET /stats — pipeline analytics for the dashboard cards + chart. */
quotationsRouter.get('/stats', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const items = await Quote.find({ accountId }).select('status totals').lean();
  const byStatus = Object.fromEntries(QUOTE_STATUSES.map((s) => [s, 0])) as Record<QuoteStatus, number>;
  let pipelineValue = 0;
  let acceptedValue = 0;
  for (const q of items) {
    byStatus[q.status as QuoteStatus] = (byStatus[q.status as QuoteStatus] ?? 0) + 1;
    const total = Number((q.totals as { total?: number } | undefined)?.total ?? 0);
    if (!['declined', 'expired'].includes(q.status as string)) pipelineValue += total;
    if (q.status === 'accepted') acceptedValue += total;
  }
  const decided = byStatus.accepted + byStatus.declined;
  const acceptanceRate = decided > 0 ? Math.round((byStatus.accepted / decided) * 100) : 0;
  res.json({ total: items.length, byStatus, pipelineValue, acceptedValue, acceptanceRate });
});

/** GET / — list quotes (optional ?status=). */
quotationsRouter.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const filter: Record<string, unknown> = { accountId: req.auth!.accountId };
  if (status && (QUOTE_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const items = await Quote.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ items });
});

/** GET /:id */
quotationsRouter.get('/:id', async (req: Request, res: Response) => {
  const quote = await Quote.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!quote) return res.status(404).json({ error: 'not_found' });
  return res.json({ quote });
});

function validUntilFrom(days: number): Date {
  return new Date(Date.now() + days * 24 * 3600 * 1000);
}

/** POST / — create a quote (totals + number computed server-side). */
quotationsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = quoteInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const accountId = req.auth!.accountId;
  const d = parsed.data;
  const totals = computeTotals(d.lineItems, { taxRatePct: d.taxRatePct, discountType: d.discountType, discountValue: d.discountValue });
  const terms = d.terms ?? (d.templateKey ? quoteTemplate(d.templateKey)?.terms : undefined);

  const quote = await Quote.create({
    accountId,
    createdBy: req.auth!.userId,
    number: await nextNumber(accountId),
    title: d.title,
    client: d.client,
    propertyAddress: d.propertyAddress,
    leadId: d.leadId || undefined,
    templateKey: d.templateKey,
    lineItems: d.lineItems,
    currency: d.currency,
    taxRatePct: d.taxRatePct,
    discountType: d.discountType,
    discountValue: d.discountValue,
    totals,
    notes: d.notes,
    terms,
    validUntil: validUntilFrom(d.validDays),
    status: 'draft',
  });
  return res.status(201).json({ quote });
});

/** PUT /:id — update a quote (recomputes totals). Accepted quotes are locked. */
quotationsRouter.put('/:id', async (req: Request, res: Response) => {
  const parsed = quoteInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const quote = await Quote.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!quote) return res.status(404).json({ error: 'not_found' });
  if (quote.status === 'accepted') return res.status(409).json({ error: 'quote_locked' });
  const d = parsed.data;
  const totals = computeTotals(d.lineItems, { taxRatePct: d.taxRatePct, discountType: d.discountType, discountValue: d.discountValue });
  Object.assign(quote, {
    title: d.title, client: d.client, propertyAddress: d.propertyAddress, leadId: d.leadId || undefined,
    templateKey: d.templateKey, lineItems: d.lineItems, currency: d.currency, taxRatePct: d.taxRatePct,
    discountType: d.discountType, discountValue: d.discountValue, totals, notes: d.notes,
    terms: d.terms ?? quote.terms, validUntil: validUntilFrom(d.validDays),
  });
  await quote.save();
  return res.json({ quote });
});

/** DELETE /:id */
quotationsRouter.delete('/:id', async (req: Request, res: Response) => {
  const quote = await Quote.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!quote) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

/** POST /:id/send — mark the quote as sent to the client. */
quotationsRouter.post('/:id/send', async (req: Request, res: Response) => {
  const quote = await Quote.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!quote) return res.status(404).json({ error: 'not_found' });
  quote.status = 'sent';
  quote.sentAt = new Date();
  await quote.save();
  emitAgentEvent(req.auth!.accountId, {
    type: 'outbound',
    agentKey: 'quotations',
    title: `Quote ${quote.number} sent to ${quote.client?.name ?? 'client'}`,
    detail: quote.title,
    status: 'done',
  });
  return res.json({ quote });
});

const statusSchema = z.object({ status: z.enum(['viewed', 'accepted', 'declined', 'expired']) });

/** PATCH /:id/status — advance the quote through its lifecycle. */
quotationsRouter.patch('/:id/status', async (req: Request, res: Response) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const quote = await Quote.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!quote) return res.status(404).json({ error: 'not_found' });
  const { status } = parsed.data;
  quote.status = status;
  if (status === 'viewed' && !quote.viewedAt) quote.viewedAt = new Date();
  if (status === 'accepted' || status === 'declined') quote.respondedAt = new Date();
  await quote.save();
  return res.json({ quote });
});

/** POST /:id/share — mint a public portal token so a client can view + accept. */
quotationsRouter.post('/:id/share', async (req: Request, res: Response) => {
  const quote = await Quote.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!quote) return res.status(404).json({ error: 'not_found' });
  if (!quote.publicToken) quote.publicToken = randomUUID();
  if (quote.status === 'draft') { quote.status = 'sent'; quote.sentAt = new Date(); }
  await quote.save();
  return res.json({ token: quote.publicToken });
});

/** POST /:id/duplicate — clone as a fresh draft. */
quotationsRouter.post('/:id/duplicate', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const src = await Quote.findOne({ _id: req.params.id, accountId }).lean();
  if (!src) return res.status(404).json({ error: 'not_found' });
  const clone = await Quote.create({
    accountId,
    createdBy: req.auth!.userId,
    number: await nextNumber(accountId),
    title: `${src.title} (copy)`,
    client: src.client,
    propertyAddress: src.propertyAddress,
    leadId: src.leadId,
    templateKey: src.templateKey,
    lineItems: src.lineItems,
    currency: src.currency,
    taxRatePct: src.taxRatePct,
    discountType: src.discountType,
    discountValue: src.discountValue,
    totals: src.totals,
    notes: src.notes,
    terms: src.terms,
    validUntil: validUntilFrom(30),
    status: 'draft',
  });
  return res.status(201).json({ quote: clone });
});
