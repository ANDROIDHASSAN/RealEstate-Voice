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
} from '@truecode/shared';
import { z } from 'zod';
import { getLLM } from '@truecode/integrations';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { getEffectiveAgent, listEffectiveAgents } from '../lib/agent-config.js';
import { retrieve, toContextBlock } from '../lib/knowledge.js';
import { Account, KnowledgeDoc, VoiceAgentConfig } from '../models.js';

const LANG_NAME: Record<string, string> = { en: 'English', es: 'Spanish', ar: 'Arabic', pt: 'Portuguese', ht: 'Haitian Creole' };

/**
 * Voice Agent Studio — CRUD for per-account agent configs (a Vapi-style
 * builder). Agents are config-driven data: presets shipped in @truecode/shared
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

const demoSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'agent']), text: z.string().max(2000) })).max(40).default([]),
});

/**
 * Browser demo — talk to an agent from the laptop, no phone/Vapi needed.
 * Uses the agent's effective config (persona, first message, model, language)
 * + the account system prompt + RAG knowledge for grounded, in-character
 * replies. Falls back to a template reply when no LLM key is set.
 */
voiceAgentsRouter.post('/:key/demo', async (req: Request, res: Response) => {
  const parsed = demoSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const accountId = req.auth!.accountId;
  const agent = await getEffectiveAgent(accountId, String(req.params.key));
  if (!agent) return res.status(404).json({ error: 'agent_not_found' });

  const account = await Account.findById(accountId).select('name ownerName voiceSystemPrompt').lean();
  const history = parsed.data.messages;

  // Opening line: if the conversation is empty, the agent speaks first.
  if (history.length === 0) {
    const first = (agent.firstMessage || 'Hi, thanks for taking my call!')
      .replace(/\{\{account\.name\}\}/g, account?.name ?? 'our team')
      .replace(/\{\{account\.ownerName\}\}/g, account?.ownerName ?? account?.name ?? 'your agent')
      .replace(/\{\{lead\.firstName\}\}/g, 'there');
    return res.json({ reply: first, grounded: false });
  }

  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.text ?? '';
  const kb = await retrieve(accountId, lastUser || agent.purpose, 4).catch(() => []);
  const knowledge = toContextBlock(kb);
  const llm = getLLM();

  const system = [
    `You are ${agent.name}, a real-estate voice agent for ${account?.name ?? 'the business'}.`,
    agent.systemPrompt ? `\nAgent instructions:\n${agent.systemPrompt}` : `\nGoal: ${agent.purpose}`,
    account?.voiceSystemPrompt ? `\nCompany instructions:\n${account.voiceSystemPrompt}` : '',
    knowledge ? `\nFACTS you may use (do not invent anything beyond these):\n${knowledge}` : '',
    `\nYou are on a LIVE phone call. Reply with ONE short, natural spoken turn (1–3 sentences) in ${LANG_NAME[agent.language] ?? 'English'}.`,
    'Do not narrate actions or use markdown. Keep moving the call toward the goal. If you do not know something, offer to have a human follow up.',
  ].join('');

  const transcript =
    history.map((m) => `${m.role === 'user' ? 'Caller' : agent.name}: ${m.text}`).join('\n') + `\n${agent.name}:`;

  let reply: string;
  try {
    reply = llm.info.live
      ? (await llm.complete(transcript, { system, temperature: agent.temperature, maxTokens: 200 })).trim()
      : demoFallback(lastUser, knowledge, agent.name);
  } catch {
    reply = demoFallback(lastUser, knowledge, agent.name);
  }

  return res.json({ reply: reply || demoFallback(lastUser, knowledge, agent.name), grounded: Boolean(knowledge), llm: llm.info });
});

/** Keyless demo reply — cites KB when available, else a helpful holding line. */
function demoFallback(userText: string, knowledge: string, name: string): string {
  if (knowledge) {
    const fact = knowledge.split('\n')[0]?.replace(/^-\s*\([^)]*\)\s*/, '') ?? '';
    return `Good question. From what I have on file: ${fact.slice(0, 180)} Would you like me to book a quick call to go over the details?`;
  }
  return `Thanks — I hear you on "${userText.slice(0, 60)}". Let me get you booked with ${name === 'you' ? 'our team' : 'one of our agents'} so we can help properly. What time works best? (Set an AI key for full conversational replies.)`;
}

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
