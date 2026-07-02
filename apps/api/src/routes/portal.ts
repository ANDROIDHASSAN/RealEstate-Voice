import { Router, type Request, type Response } from 'express';
import { signDocumentSchema } from '@truecode/shared';
import { z } from 'zod';
import { emitAgentEvent } from '../lib/events.js';
import { Account, DocumentRecord, Invoice, Quote } from '../models.js';

/**
 * Client / Owner Portal — PUBLIC, unauthenticated read + act by opaque token.
 * A client opens a shared link (/portal/:kind/:token) to view a quote, invoice,
 * or document and accept / sign it. No session; the token is the capability.
 * Only whitelisted, non-sensitive fields are returned; account name is included
 * for branding.
 */
export const portalRouter = Router();

async function brand(accountId: unknown): Promise<{ name: string; owner?: string }> {
  const acc = await Account.findById(accountId).select('name ownerName').lean();
  return { name: acc?.name ?? 'CloseFlow', owner: acc?.ownerName ?? undefined };
}

// ---- Quotes ----
portalRouter.get('/quote/:token', async (req: Request, res: Response) => {
  const quote = await Quote.findOne({ publicToken: req.params.token });
  if (!quote) return res.status(404).json({ error: 'not_found' });
  if (quote.status === 'sent') { quote.status = 'viewed'; quote.viewedAt = new Date(); await quote.save(); }
  return res.json({
    kind: 'quote',
    brand: await brand(quote.accountId),
    doc: {
      number: quote.number, title: quote.title, client: quote.client, propertyAddress: quote.propertyAddress,
      lineItems: quote.lineItems, currency: quote.currency, taxRatePct: quote.taxRatePct, totals: quote.totals,
      notes: quote.notes, terms: quote.terms, validUntil: quote.validUntil, status: quote.status,
    },
  });
});

const respondSchema = z.object({ accept: z.boolean() });
portalRouter.post('/quote/:token/respond', async (req: Request, res: Response) => {
  const parsed = respondSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const quote = await Quote.findOne({ publicToken: req.params.token });
  if (!quote) return res.status(404).json({ error: 'not_found' });
  if (quote.status === 'accepted' || quote.status === 'declined') return res.status(409).json({ error: 'already_responded' });
  quote.status = parsed.data.accept ? 'accepted' : 'declined';
  quote.respondedAt = new Date();
  await quote.save();
  emitAgentEvent(String(quote.accountId), {
    type: 'agent:done', agentKey: 'quotations',
    title: `Quote ${quote.number} ${quote.status} by client`, detail: quote.title,
    status: quote.status === 'accepted' ? 'done' : 'blocked',
  });
  return res.json({ status: quote.status });
});

// ---- Invoices ----
portalRouter.get('/invoice/:token', async (req: Request, res: Response) => {
  const invoice = await Invoice.findOne({ publicToken: req.params.token }).lean();
  if (!invoice) return res.status(404).json({ error: 'not_found' });
  return res.json({
    kind: 'invoice',
    brand: await brand(invoice.accountId),
    doc: {
      number: invoice.number, title: invoice.title, client: invoice.client, propertyAddress: invoice.propertyAddress,
      lineItems: invoice.lineItems, currency: invoice.currency, taxRatePct: invoice.taxRatePct, totals: invoice.totals,
      amountPaid: invoice.amountPaid, balance: invoice.balance, dueDate: invoice.dueDate, status: invoice.status, notes: invoice.notes,
    },
  });
});

// ---- Documents (e-sign) ----
portalRouter.get('/document/:token', async (req: Request, res: Response) => {
  const doc = await DocumentRecord.findOne({ publicToken: req.params.token });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  if (doc.status === 'sent') { doc.status = 'viewed'; await doc.save(); }
  return res.json({
    kind: 'document',
    brand: await brand(doc.accountId),
    doc: {
      number: doc.number, title: doc.title, client: doc.client, propertyAddress: doc.propertyAddress,
      body: doc.body, status: doc.status, signature: doc.signature,
    },
  });
});

portalRouter.post('/document/:token/sign', async (req: Request, res: Response) => {
  const parsed = signDocumentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const doc = await DocumentRecord.findOne({ publicToken: req.params.token });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  if (doc.status === 'signed') return res.status(409).json({ error: 'already_signed' });
  if (!parsed.data.accept) {
    doc.status = 'declined';
    await doc.save();
    return res.json({ status: 'declined' });
  }
  doc.status = 'signed';
  doc.signature = { name: parsed.data.signerName, signedAt: new Date(), ip: req.ip } as never;
  await doc.save();
  emitAgentEvent(String(doc.accountId), { type: 'agent:done', agentKey: 'documents', title: `Document ${doc.number} signed by ${parsed.data.signerName}`, detail: doc.title, status: 'done' });
  return res.json({ status: 'signed' });
});
