import { Router, type Request, type Response } from 'express';
import { DOC_STATUSES, DOC_TEMPLATES, documentInputSchema } from '@truecode/shared';
import { randomUUID } from 'node:crypto';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { DocumentRecord } from '../models.js';

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireModule('documents'), rbacWrite);

async function nextNumber(accountId: string): Promise<string> {
  const count = await DocumentRecord.countDocuments({ accountId });
  return `DOC-${new Date().getUTCFullYear()}-${String(count + 1).padStart(4, '0')}`;
}

documentsRouter.get('/templates', (_req: Request, res: Response) => {
  res.json({ templates: DOC_TEMPLATES });
});

documentsRouter.get('/', async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const filter: Record<string, unknown> = { accountId: req.auth!.accountId };
  if (status && (DOC_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const items = await DocumentRecord.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  res.json({ items });
});

documentsRouter.get('/:id', async (req: Request, res: Response) => {
  const doc = await DocumentRecord.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!doc) return res.status(404).json({ error: 'not_found' });
  return res.json({ document: doc });
});

documentsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = documentInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;
  const doc = await DocumentRecord.create({
    accountId: req.auth!.accountId, createdBy: req.auth!.userId, number: await nextNumber(req.auth!.accountId),
    title: d.title, templateKey: d.templateKey, client: d.client, propertyAddress: d.propertyAddress,
    body: d.body, dealId: d.dealId || undefined, leadId: d.leadId || undefined, status: 'draft',
  });
  return res.status(201).json({ document: doc });
});

documentsRouter.put('/:id', async (req: Request, res: Response) => {
  const parsed = documentInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const doc = await DocumentRecord.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  if (doc.status === 'signed') return res.status(409).json({ error: 'document_signed' });
  const d = parsed.data;
  Object.assign(doc, { title: d.title, client: d.client, propertyAddress: d.propertyAddress, body: d.body, templateKey: d.templateKey });
  await doc.save();
  return res.json({ document: doc });
});

documentsRouter.delete('/:id', async (req: Request, res: Response) => {
  const doc = await DocumentRecord.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

/** POST /:id/send — issue for e-signature; mints a public portal token. */
documentsRouter.post('/:id/send', async (req: Request, res: Response) => {
  const doc = await DocumentRecord.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  doc.status = 'sent';
  doc.sentAt = new Date();
  if (!doc.publicToken) doc.publicToken = randomUUID();
  await doc.save();
  emitAgentEvent(req.auth!.accountId, { type: 'outbound', agentKey: 'documents', title: `Document ${doc.number} sent for signature`, detail: doc.title, status: 'done' });
  return res.json({ document: doc, token: doc.publicToken });
});
