import { Router, type Request, type Response } from 'express';
import {
  AGENT_LANGUAGES,
  AGENT_TOOLS,
  LLM_MODELS,
  LLM_PROVIDERS,
  STT_MODELS,
  STT_PROVIDERS,
  TTS_PROVIDERS,
  TTS_VOICES,
} from '@closeflow/shared';
import { z } from 'zod';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { getEffectiveAgent, listEffectiveAgents } from '../lib/agent-config.js';
import { KnowledgeDoc, VoiceAgentConfig } from '../models.js';

/**
 * Voice Agent Studio — CRUD for per-account agent configs (a Vapi-style
 * builder). Agents are config-driven data: presets shipped in @closeflow/shared
 * can be overridden per account, and brand-new custom agents can be created.
 */
export const voiceAgentsRouter = Router();
voiceAgentsRouter.use(requireAuth, requireModule('voice'));

/** The builder's option catalog (dropdowns + tool toggles) for the UI. */
const CATALOG = {
  transcriberProviders: STT_PROVIDERS,
  transcriberModels: STT_MODELS,
  modelProviders: LLM_PROVIDERS,
  models: LLM_MODELS,
  voiceProviders: TTS_PROVIDERS,
  voices: TTS_VOICES,
  tools: AGENT_TOOLS,
  languages: AGENT_LANGUAGES,
};

const ALLOWED_TOOLS = new Set(AGENT_TOOLS.map((t) => t.value));

voiceAgentsRouter.get('/', async (req: Request, res: Response) => {
  const [agents, docs] = await Promise.all([
    listEffectiveAgents(req.auth!.accountId),
    KnowledgeDoc.find({ accountId: req.auth!.accountId }).select('title chunkCount').lean(),
  ]);
  res.json({ agents, catalog: CATALOG, knowledgeDocs: docs });
});

const configSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  language: z.enum(['en', 'es', 'ar', 'pt', 'ht']).optional(),
  purpose: z.string().max(500).optional(),
  firstMessage: z.string().max(1000).optional(),
  systemPrompt: z.string().max(6000).optional(),
  transcriberProvider: z.string().max(40).optional(),
  transcriberModel: z.string().max(60).optional(),
  modelProvider: z.string().max(40).optional(),
  modelName: z.string().max(80).optional(),
  temperature: z.number().min(0).max(2).optional(),
  voiceProvider: z.string().max(40).optional(),
  voiceId: z.string().max(80).optional(),
  tools: z.array(z.string().max(40)).max(20).optional(),
  knowledgeDocIds: z.array(z.string().max(40)).max(50).optional(),
  enabled: z.boolean().optional(),
});

/** Create a brand-new custom agent. */
voiceAgentsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const name = parsed.data.name?.trim() || 'New Agent';
  const slug = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)}-${String(Date.now()).slice(-5)}`;
  const clean = sanitize(parsed.data);
  await VoiceAgentConfig.create({ accountId: req.auth!.accountId, key: slug, custom: true, name, ...clean });
  const agent = await getEffectiveAgent(req.auth!.accountId, slug);
  return res.status(201).json({ agent });
});

/** Update a preset override or a custom agent. */
voiceAgentsRouter.put('/:key', async (req: Request, res: Response) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const clean = sanitize(parsed.data);
  await VoiceAgentConfig.findOneAndUpdate(
    { accountId: req.auth!.accountId, key: req.params.key },
    { $set: clean },
    { upsert: true, new: true },
  );
  const agent = await getEffectiveAgent(req.auth!.accountId, String(req.params.key));
  if (!agent) return res.status(404).json({ error: 'not_found' });
  return res.json({ agent });
});

/** Delete a custom agent, or reset a preset override to defaults. */
voiceAgentsRouter.delete('/:key', async (req: Request, res: Response) => {
  await VoiceAgentConfig.deleteOne({ accountId: req.auth!.accountId, key: req.params.key });
  return res.json({ ok: true });
});

/** Drop tools outside the catalog; pass the rest through untouched. */
function sanitize(data: z.infer<typeof configSchema>) {
  const clean: Record<string, unknown> = { ...data };
  if (data.tools) clean.tools = data.tools.filter((t) => ALLOWED_TOOLS.has(t));
  return clean;
}
