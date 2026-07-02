import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { knowledgeDocSchema, knowledgeSearchSchema, voicePromptSchema } from '@truecode/shared';
import { getEmbeddings } from '@truecode/integrations';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '../logger.js';
import { emitAgentEvent } from '../lib/events.js';
import { extractText, stripHtml, titleFromHtml } from '../lib/extract.js';
import { ingestDocument, retrieve } from '../lib/knowledge.js';
import { Account, KnowledgeDoc } from '../models.js';

// In-memory upload — 15MB cap; text is extracted then discarded (not stored raw).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

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

/** Upload a document (PDF / DOCX / TXT / MD / CSV / HTML) — extract + ingest. */
knowledgeRouter.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'no_file' });
  let text: string;
  try {
    text = await extractText(file.buffer, file.originalname, file.mimetype);
  } catch (err) {
    logger.warn({ err: (err as Error).message, file: file.originalname }, 'document extraction failed');
    return res.status(400).json({ error: 'could_not_read_file' });
  }
  if (!text.trim()) return res.status(400).json({ error: 'no_text_found' });
  // Cap very large docs so ingest stays fast/cheap (each chunk = 1 embed call).
  const MAX = 60_000;
  const truncated = text.length > MAX;
  const title = (typeof req.body?.title === 'string' && req.body.title.trim()) || file.originalname.replace(/\.[^.]+$/, '');
  const result = await ingestDocument(req.auth!.accountId, title.slice(0, 180), text.slice(0, MAX), `upload:${file.originalname.split('.').pop() ?? 'file'}`);
  emitAgentEvent(req.auth!.accountId, {
    type: 'agent:done',
    agentKey: 'knowledge-base',
    title: `Learned "${title}"`,
    detail: `Uploaded ${file.originalname} · ${result.chunkCount} chunks`,
    status: 'done',
  });
  return res.status(201).json({ ...result, truncated });
});

const urlSchema = z.object({ url: z.string().url() });

/** Import a web page (like NotebookLM sources) — fetch, strip, ingest. */
knowledgeRouter.post('/url', async (req: Request, res: Response) => {
  const parsed = urlSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_url' });
  let html: string;
  try {
    const r = await fetch(parsed.data.url, { headers: { 'User-Agent': 'TrueCodeBot/1.0' }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) return res.status(400).json({ error: `fetch_failed_${r.status}` });
    html = await r.text();
  } catch (err) {
    return res.status(400).json({ error: 'fetch_failed', detail: (err as Error).message });
  }
  const text = stripHtml(html);
  if (text.length < 40) return res.status(400).json({ error: 'no_text_found' });
  const host = new URL(parsed.data.url).hostname;
  const title = titleFromHtml(html, host);
  const result = await ingestDocument(req.auth!.accountId, title, text.slice(0, 50_000), `url:${host}`);
  return res.status(201).json(result);
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
