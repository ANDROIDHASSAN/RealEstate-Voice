import { Router, type Request, type Response } from 'express';
import { computeTotals, invoiceBalance, invoiceInputSchema, recordPaymentSchema, INVOICE_STATUSES } from '@truecode/shared';
import { randomUUID } from 'node:crypto';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { Invoice, Quote } from '../models.js';

export const invoicingRouter = Router();
invoicingRouter.use(requireAuth, requireModule('invoicing'), rbacWrite);

async function nextNumber(accountId: string): Promise<string> {
  const count = await Invoice.countDocuments({ accountId });
  return `INV-${new Date().getUTCFullYear()}-${String(count + 1).padStart(4, '0')}`;
}
const dueFrom = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000);

invoicingRouter.get('/stats', async (req: Request, res: Response) => {
  const items = await Invoice.find({ accountId: req.auth!.accountId }).select('status totals amountPaid balance').lean();
  const byStatus = Object.fromEntries(INVOICE_STATUSES.map((s) => [s, 0])) as Record<string, number>;
  let outstanding = 0;
  let collected = 0;
  for (const i of items) {
    byStatus[i.status as string] = (byStatus[i.status as string] ?? 0) + 1;
    if (i.status !== 'void') { outstanding += Number(i.balance ?? 0); collected += Number(i.amountPaid ?? 0); }
  }
  res.json({ total: items.length, byStatus, outstanding: Math.round(outstanding * 100) / 100, collected: Math.round(collected * 100) / 100 });
});

invoicingRouter.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const filter: Record<string, unknown> = { accountId: req.auth!.accountId };
  if (status && (INVOICE_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const items = await Invoice.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ items });
});

invoicingRouter.get('/:id', async (req: Request, res: Response) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!invoice) return res.status(404).json({ error: 'not_found' });
  return res.json({ invoice });
});

async function build(accountId: string, userId: string, d: import('@truecode/shared').InvoiceInput) {
  const totals = computeTotals(d.lineItems, { taxRatePct: d.taxRatePct, discountType: d.discountType, discountValue: d.discountValue });
  return Invoice.create({
    accountId, createdBy: userId, number: await nextNumber(accountId), title: d.title, client: d.client,
    propertyAddress: d.propertyAddress, quoteId: d.quoteId || undefined, dealId: d.dealId || undefined,
    lineItems: d.lineItems, currency: d.currency, taxRatePct: d.taxRatePct, discountType: d.discountType,
    discountValue: d.discountValue, totals, notes: d.notes, dueDate: dueFrom(d.dueDays),
    amountPaid: 0, balance: totals.total, status: 'draft',
  });
}

invoicingRouter.post('/', async (req: Request, res: Response) => {
  const parsed = invoiceInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const invoice = await build(req.auth!.accountId, req.auth!.userId, parsed.data);
  return res.status(201).json({ invoice });
});

/** POST /from-quote/:quoteId — turn an accepted quote into an invoice. */
invoicingRouter.post('/from-quote/:quoteId', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const quote = await Quote.findOne({ _id: req.params.quoteId, accountId }).lean();
  if (!quote) return res.status(404).json({ error: 'not_found' });
  const invoice = await build(accountId, req.auth!.userId, {
    title: `Invoice — ${quote.title}`,
    client: { name: quote.client?.name ?? 'Client', email: quote.client?.email ?? '', phone: quote.client?.phone ?? undefined, address: quote.client?.address ?? undefined },
    propertyAddress: quote.propertyAddress ?? undefined,
    quoteId: String(quote._id),
    lineItems: (quote.lineItems ?? []).map((li) => ({ description: li.description ?? '', category: li.category ?? undefined, quantity: li.quantity ?? 1, unitPrice: li.unitPrice ?? 0 })),
    currency: (quote.currency as import('@truecode/shared').InvoiceInput['currency']) ?? 'USD',
    taxRatePct: quote.taxRatePct ?? 0,
    discountType: (quote.discountType as 'none' | 'percent' | 'amount') ?? 'none',
    discountValue: quote.discountValue ?? 0,
    dueDays: 14,
  });
  return res.status(201).json({ invoice });
});

invoicingRouter.put('/:id', async (req: Request, res: Response) => {
  const parsed = invoiceInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const invoice = await Invoice.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!invoice) return res.status(404).json({ error: 'not_found' });
  if (invoice.status === 'paid') return res.status(409).json({ error: 'invoice_paid' });
  const d = parsed.data;
  const totals = computeTotals(d.lineItems, { taxRatePct: d.taxRatePct, discountType: d.discountType, discountValue: d.discountValue });
  const bal = invoiceBalance(totals, invoice.payments as { amount: number }[]);
  Object.assign(invoice, {
    title: d.title, client: d.client, propertyAddress: d.propertyAddress, lineItems: d.lineItems, currency: d.currency,
    taxRatePct: d.taxRatePct, discountType: d.discountType, discountValue: d.discountValue, totals, notes: d.notes,
    dueDate: dueFrom(d.dueDays), balance: bal.balance,
  });
  await invoice.save();
  return res.json({ invoice });
});

invoicingRouter.delete('/:id', async (req: Request, res: Response) => {
  const invoice = await Invoice.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!invoice) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

invoicingRouter.post('/:id/send', async (req: Request, res: Response) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!invoice) return res.status(404).json({ error: 'not_found' });
  invoice.status = invoice.amountPaid > 0 ? 'partial' : 'sent';
  invoice.sentAt = new Date();
  if (!invoice.publicToken) invoice.publicToken = randomUUID();
  await invoice.save();
  emitAgentEvent(req.auth!.accountId, { type: 'outbound', agentKey: 'invoicing', title: `Invoice ${invoice.number} sent`, detail: invoice.title, status: 'done' });
  return res.json({ invoice });
});

/** POST /:id/pay — record a payment; recomputes balance + status. */
invoicingRouter.post('/:id/pay', async (req: Request, res: Response) => {
  const parsed = recordPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const invoice = await Invoice.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!invoice) return res.status(404).json({ error: 'not_found' });
  invoice.payments.push({ ...parsed.data, ts: new Date() } as never);
  const bal = invoiceBalance(invoice.totals as import('@truecode/shared').QuoteTotals, invoice.payments as { amount: number }[]);
  invoice.amountPaid = bal.paid;
  invoice.balance = bal.balance;
  invoice.status = bal.status;
  if (bal.status === 'paid') invoice.paidAt = new Date();
  await invoice.save();
  return res.json({ invoice });
});

invoicingRouter.post('/:id/share', async (req: Request, res: Response) => {
  const invoice = await Invoice.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!invoice) return res.status(404).json({ error: 'not_found' });
  if (!invoice.publicToken) invoice.publicToken = randomUUID();
  await invoice.save();
  return res.json({ token: invoice.publicToken });
});
