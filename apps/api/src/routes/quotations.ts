import { Router, type Request, type Response } from 'express';
import {
  computeTotals,
  customTemplateInputSchema,
  DEFAULT_QUOTE_SETTINGS,
  quoteSettingsSchema,
  QUOTE_STATUSES,
  QUOTE_TEMPLATES,
  quoteInputSchema,
  quoteTemplate,
  type QuoteStatus,
  type QuoteTemplate,
} from '@truecode/shared';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { Quote, QuoteTemplateDoc, QuoteSettings } from '../models.js';

export const quotationsRouter = Router();
quotationsRouter.use(requireAuth, requireModule('quotations'), rbacWrite);

/** Sequential, human-friendly quote number scoped to the account. */
async function nextNumber(accountId: string): Promise<string> {
  const count = await Quote.countDocuments({ accountId });
  const year = new Date().getUTCFullYear();
  return `QT-${year}-${String(count + 1).padStart(4, '0')}`;
}

function validUntilFrom(days: number): Date {
  return new Date(Date.now() + days * 24 * 3600 * 1000);
}

/** Shape a persisted custom-template doc into the shared QuoteTemplate DTO. */
function customToTemplate(doc: Record<string, unknown>): QuoteTemplate {
  return {
    key: `custom:${String(doc._id)}`,
    _id: String(doc._id),
    custom: true,
    name: String(doc.name ?? 'Template'),
    description: String(doc.description ?? ''),
    category: String(doc.category ?? 'Custom'),
    defaultTaxRatePct: doc.defaultTaxRatePct as number | undefined,
    accentColor: doc.accentColor as string | undefined,
    currency: doc.currency as QuoteTemplate['currency'],
    notes: doc.notes as string | undefined,
    terms: String(doc.terms ?? ''),
    lineItems: (doc.lineItems as QuoteTemplate['lineItems']) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Settings (managed categories + branding + defaults)
// ---------------------------------------------------------------------------

/** GET /settings — the account's quote defaults; seeded on first read. */
quotationsRouter.get('/settings', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const doc = await QuoteSettings.findOne({ accountId }).lean();
  if (!doc) return res.json({ settings: DEFAULT_QUOTE_SETTINGS });
  const { _id, accountId: _a, createdAt, updatedAt, __v, ...settings } = doc as Record<string, unknown>;
  return res.json({ settings: { ...DEFAULT_QUOTE_SETTINGS, ...settings } });
});

/** PUT /settings — upsert the account's quote defaults. */
quotationsRouter.put('/settings', async (req: Request, res: Response) => {
  const parsed = quoteSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const accountId = req.auth!.accountId;
  // De-dupe + trim categories, preserving order.
  const categories = Array.from(new Set(parsed.data.categories.map((c) => c.trim()).filter(Boolean)));
  const doc = await QuoteSettings.findOneAndUpdate(
    { accountId },
    { $set: { ...parsed.data, categories, accountId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  const { _id, accountId: _a, createdAt, updatedAt, __v, ...settings } = doc as Record<string, unknown>;
  return res.json({ settings });
});

// ---------------------------------------------------------------------------
// Templates — built-in catalog + account-authored custom templates
// ---------------------------------------------------------------------------

/** GET /templates — built-in catalog + this account's custom templates. */
quotationsRouter.get('/templates', async (req: Request, res: Response) => {
  const custom = await QuoteTemplateDoc.find({ accountId: req.auth!.accountId }).sort({ updatedAt: -1 }).lean();
  res.json({ templates: QUOTE_TEMPLATES, custom: custom.map(customToTemplate) });
});

/** POST /templates — create a custom template. */
quotationsRouter.post('/templates', async (req: Request, res: Response) => {
  const parsed = customTemplateInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const doc = await QuoteTemplateDoc.create({ ...parsed.data, accountId: req.auth!.accountId, createdBy: req.auth!.userId });
  return res.status(201).json({ template: customToTemplate(doc.toObject()) });
});

/** POST /templates/import — upload a template (JSON). Same shape as create. */
quotationsRouter.post('/templates/import', async (req: Request, res: Response) => {
  // Accept a bare template or one wrapped in { template: … }.
  const payload = (req.body && typeof req.body === 'object' && 'template' in req.body) ? (req.body as { template: unknown }).template : req.body;
  const parsed = customTemplateInputSchema.safeParse(payload);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const doc = await QuoteTemplateDoc.create({ ...parsed.data, accountId: req.auth!.accountId, createdBy: req.auth!.userId });
  return res.status(201).json({ template: customToTemplate(doc.toObject()) });
});

/** PUT /templates/:id — update a custom template. */
quotationsRouter.put('/templates/:id', async (req: Request, res: Response) => {
  const parsed = customTemplateInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const doc = await QuoteTemplateDoc.findOneAndUpdate(
    { _id: req.params.id, accountId: req.auth!.accountId },
    { $set: parsed.data },
    { new: true },
  ).lean();
  if (!doc) return res.status(404).json({ error: 'not_found' });
  return res.json({ template: customToTemplate(doc as Record<string, unknown>) });
});

/** DELETE /templates/:id — remove a custom template. */
quotationsRouter.delete('/templates/:id', async (req: Request, res: Response) => {
  const doc = await QuoteTemplateDoc.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Quotes CRUD + lifecycle
// ---------------------------------------------------------------------------

/** GET / — list quotes (optional ?status=, ?q= search). */
quotationsRouter.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const q = (req.query.q as string | undefined)?.trim();
  const filter: Record<string, unknown> = { accountId: req.auth!.accountId };
  if (status && (QUOTE_STATUSES as readonly string[]).includes(status)) filter.status = status;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ title: rx }, { number: rx }, { 'client.name': rx }];
  }
  const items = await Quote.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ items });
});

/** GET /:id */
quotationsRouter.get('/:id', async (req: Request, res: Response) => {
  const quote = await Quote.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!quote) return res.status(404).json({ error: 'not_found' });
  return res.json({ quote });
});

/** The persisted fields derived from a validated quote input. */
function quoteFields(d: import('@truecode/shared').QuoteInput) {
  const totals = computeTotals(d.lineItems, {
    taxRatePct: d.taxRatePct, discountType: d.discountType, discountValue: d.discountValue,
    depositType: d.depositType, depositValue: d.depositValue,
  });
  return {
    title: d.title, client: d.client, propertyAddress: d.propertyAddress, leadId: d.leadId || undefined,
    templateKey: d.templateKey, lineItems: d.lineItems, currency: d.currency,
    taxRatePct: d.taxRatePct, taxLabel: d.taxLabel, discountType: d.discountType, discountValue: d.discountValue,
    depositType: d.depositType, depositValue: d.depositValue, totals, notes: d.notes, terms: d.terms,
    summary: d.summary, accentColor: d.accentColor, logoUrl: d.logoUrl || undefined,
    validUntil: validUntilFrom(d.validDays),
  };
}

/** POST / — create a quote (totals + number computed server-side). */
quotationsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = quoteInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const accountId = req.auth!.accountId;
  const d = parsed.data;
  const fields = quoteFields(d);
  if (!fields.terms && d.templateKey && !d.templateKey.startsWith('custom:')) fields.terms = quoteTemplate(d.templateKey)?.terms;
  const quote = await Quote.create({
    accountId, createdBy: req.auth!.userId, number: await nextNumber(accountId), status: 'draft', ...fields,
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
  const fields = quoteFields(parsed.data);
  Object.assign(quote, { ...fields, terms: fields.terms ?? quote.terms });
  await quote.save();
  return res.json({ quote });
});

/** DELETE /:id */
quotationsRouter.delete('/:id', async (req: Request, res: Response) => {
  const quote = await Quote.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!quote) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

/** POST /:id/save-as-template — persist a quote's contents as a reusable template. */
quotationsRouter.post('/:id/save-as-template', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const quote = await Quote.findOne({ _id: req.params.id, accountId }).lean();
  if (!quote) return res.status(404).json({ error: 'not_found' });
  const nameOverride = z.object({ name: z.string().min(2).max(120).optional(), category: z.string().max(60).optional() }).safeParse(req.body ?? {});
  const doc = await QuoteTemplateDoc.create({
    accountId, createdBy: req.auth!.userId,
    name: nameOverride.success ? (nameOverride.data.name ?? quote.title) : quote.title,
    description: `Saved from quote ${quote.number}`,
    category: (nameOverride.success && nameOverride.data.category) || 'Custom',
    terms: quote.terms ?? '', notes: quote.notes,
    defaultTaxRatePct: quote.taxRatePct, accentColor: quote.accentColor, currency: quote.currency,
    lineItems: quote.lineItems ?? [],
  });
  return res.status(201).json({ template: customToTemplate(doc.toObject()) });
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
  const { _id, number, status, sentAt, viewedAt, respondedAt, publicToken, createdAt, updatedAt, __v, ...rest } = src as Record<string, unknown>;
  const clone = await Quote.create({
    ...rest,
    accountId,
    createdBy: req.auth!.userId,
    number: await nextNumber(accountId),
    title: `${String(src.title)} (copy)`,
    validUntil: validUntilFrom(30),
    status: 'draft',
  });
  return res.status(201).json({ quote: clone });
});
