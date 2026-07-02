import { Router, type Request, type Response } from 'express';
import { knowledgeDocSchema, knowledgeSearchSchema, voicePromptSchema } from '@closeflow/shared';
import { getEmbeddings } from '@closeflow/integrations';
import { requireAuth } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { ingestDocument, retrieve } from '../lib/knowledge.js';
import { Account, KnowledgeDoc } from '../models.js';

/**
 * Knowledge base (RAG) + the voice agent's system prompt. Documents are
 * chunked + embedded on ingest; retrieval grounds the voice agent and the
 * assistant in the account's own facts (listings, policies, financing, FAQs).
 */
export const knowledgeRouter = Router();
knowledgeRouter.use(requireAuth);

/** List documents (metadata only) + embeddings status + current system prompt. */
knowledgeRouter.get('/', async (req: Request, res: Response) => {
  const [docs, account] = await Promise.all([
    KnowledgeDoc.find({ accountId: req.auth!.accountId }).select('title source chunkCount embedded createdAt').sort({ createdAt: -1 }).lean(),
    Account.findById(req.auth!.accountId).select('voiceSystemPrompt').lean(),
  ]);
  res.json({
    docs,
    embeddings: getEmbeddings().info,
    systemPrompt: account?.voiceSystemPrompt ?? '',
  });
});

/** Add a document — chunk, embed, store. */
knowledgeRouter.post('/', async (req: Request, res: Response) => {
  const parsed = knowledgeDocSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  try {
    const result = await ingestDocument(req.auth!.accountId, parsed.data.title, parsed.data.content, parsed.data.source);
    emitAgentEvent(req.auth!.accountId, {
      type: 'agent:done',
      agentKey: 'knowledge-base',
      title: `Learned "${parsed.data.title}"`,
      detail: `${result.chunkCount} chunks · ${result.embedded ? 'semantic embeddings' : 'keyword index'}`,
      status: 'done',
    });
    return res.status(201).json(result);
  } catch (err) {
    if ((err as Error).message === 'empty_document') return res.status(400).json({ error: 'empty_document' });
    throw err;
  }
});

knowledgeRouter.delete('/:id', async (req: Request, res: Response) => {
  const del = await KnowledgeDoc.deleteOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!del.deletedCount) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

/** Test retrieval — "ask your knowledge base" (also proves RAG is grounded). */
knowledgeRouter.post('/search', async (req: Request, res: Response) => {
  const parsed = knowledgeSearchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const chunks = await retrieve(req.auth!.accountId, parsed.data.query, parsed.data.k ?? 4);
  return res.json({ chunks, embeddings: getEmbeddings().info });
});

/** Save the account-wide voice-agent system prompt (persona/instructions). */
knowledgeRouter.put('/prompt', async (req: Request, res: Response) => {
  const parsed = voicePromptSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const account = await Account.findByIdAndUpdate(
    req.auth!.accountId,
    { voiceSystemPrompt: parsed.data.systemPrompt },
    { new: true },
  ).select('voiceSystemPrompt');
  return res.json({ systemPrompt: account?.voiceSystemPrompt ?? '' });
});
