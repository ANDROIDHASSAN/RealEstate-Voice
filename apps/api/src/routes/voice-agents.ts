import { Router, type Request, type Response } from 'express';
import {
  AGENT_LANGUAGES,
  AGENT_TOOLS,
  buildSalesSystemPrompt,
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
    return res.json({ reply: fillDemoMerge(agent.firstMessage || 'Hi, thanks for taking my call!', account), grounded: false });
  }

  const lastUser = [...history].reverse().find((m) => m.role === 'user')?.text ?? '';
  const kb = await retrieve(accountId, lastUser || agent.purpose, 4).catch(() => []);
  const knowledge = toContextBlock(kb);
  const llm = getLLM();

  const system = buildSalesSystemPrompt({
    agentName: agent.name,
    businessName: account?.name ?? 'the business',
    purpose: agent.purpose,
    agentInstructions: agent.systemPrompt || undefined,
    companyInstructions: account?.voiceSystemPrompt || undefined,
    knowledge: knowledge || undefined,
    defaultLanguage: LANG_NAME[agent.language] ?? 'English',
  });

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

/**
 * Fill merge tokens with sample values for the browser demo (there is no real
 * lead), then strip any remaining {{…}} so the caller never hears "{{lead.x}}".
 */
function fillDemoMerge(text: string, account: { name?: string | null; ownerName?: string | null } | null): string {
  return text
    .replace(/\{\{account\.name\}\}/g, account?.name ?? 'our team')
    .replace(/\{\{account\.ownerName\}\}/g, account?.ownerName ?? account?.name ?? 'your agent')
    .replace(/\{\{lead\.firstName\}\}/g, 'there')
    .replace(/\{\{lead\.propertyInterest\}\}/g, 'the property you were looking at')
    .replace(/\{\{lead\.location\}\}/g, 'your area')
    .replace(/\{\{lead\.budget\}\}/g, 'your budget')
    .replace(/\{\{\s*[\w.]+\s*\}\}/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Keyless demo reply — a lightweight closer: detects common objections and
 * responds with acknowledge → reframe → advance, cites the KB when available.
 * (Full multilingual conversation needs an LLM key; this keeps the demo alive.)
 */
function demoFallback(userText: string, knowledge: string, name: string): string {
  const q = userText.toLowerCase();
  const advance = 'Would Thursday at 5 or Saturday at 11 work better for a quick viewing?';
  if (/expensive|too much|budget|afford|price|cost/.test(q))
    return `I hear you on price. The right home is an investment, not just a cost — and financing can make the numbers work. If we made it fit, would the home itself be right for you? ${advance}`;
  if (/think|not sure|maybe|later|not ready|just look/.test(q))
    return `Totally fair — no pressure at all. What specifically would you want to think through: price, location, or timing? I'll get you the exact info so you can decide with confidence.`;
  if (/spouse|wife|husband|partner|talk to/.test(q))
    return `Smart — a decision like this should be made together. Could we do a quick 10-minute call with both of you so nobody feels rushed? ${advance}`;
  if (/market|bad time|wait|interest rate|economy/.test(q))
    return `Understandable. A lot of my buyers felt that too — then found waiting cost them the right place. Let's just get you ready so you can move when it's perfect. ${advance}`;
  if (knowledge) {
    const fact = knowledge.split('\n')[0]?.replace(/^-\s*\([^)]*\)\s*/, '') ?? '';
    return `Great question. From what I have on file: ${fact.slice(0, 170)} Want me to walk you through it on a quick viewing? ${advance}`;
  }
  return `Love that you reached out. Tell me — if we found the perfect place, what would that change for you? Then ${advance.charAt(0).toLowerCase()}${advance.slice(1)}`;
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
