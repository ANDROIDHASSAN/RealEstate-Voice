import { Router, type Request, type Response } from 'express';
import { assistantActionSchema, assistantCommandSchema, getLeadPersona, buildPersonaQuery, LEAD_PERSONAS } from '@closeflow/shared';
import { getLLM } from '@closeflow/integrations';
import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { sendOutbound } from '../lib/outbound.js';
import { Account, Lead, ScrapeJob } from '../models.js';

/**
 * CloseFlow Assistant — one natural-language command (typed or voice) in,
 * a structured, auditable action out. The LLM only PLANS (closed action set,
 * Zod-validated); Node EXECUTES through the same gated paths as the UI
 * (queue + ComplianceGuard). In mock mode a deterministic parser keeps the
 * assistant fully usable without any API key.
 */

export const assistantRouter = Router();
assistantRouter.use(requireAuth);

interface AssistantStep {
  agentKey: string;
  title: string;
  detail?: string;
  status: 'done' | 'error' | 'blocked';
}

const PAGES: Record<string, string> = {
  dashboard: '/', home: '/', leads: '/leads', voice: '/voice', calls: '/voice',
  'follow-up': '/followup', followup: '/followup', inbox: '/inbox',
  'lead engine': '/lead-engine', 'lead-engine': '/lead-engine', scraper: '/lead-engine',
  content: '/content', agents: '/agents', team: '/agents', website: '/website',
  billing: '/billing', settings: '/settings',
};

const LOCALES: Record<string, string> = {
  english: 'en', spanish: 'es', español: 'es', arabic: 'ar', عربي: 'ar',
  portuguese: 'pt', português: 'pt', 'haitian creole': 'ht', creole: 'ht', kreyòl: 'ht',
};

assistantRouter.post('/command', async (req: Request, res: Response) => {
  const parsed = assistantCommandSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const accountId = req.auth!.accountId;
  const { text, page, locale } = parsed.data;

  emitAgentEvent(accountId, {
    type: 'assistant',
    agentKey: 'assistant',
    title: 'Assistant heard a command',
    detail: text.slice(0, 140),
    status: 'running',
  });

  const llm = getLLM();
  let action = llm.info.live ? await planWithLLM(text, page, locale) : null;
  if (!action) action = planDeterministic(text);

  const steps: AssistantStep[] = [
    {
      agentKey: 'router',
      title: llm.info.live ? `Understood via ${llm.info.name}` : 'Understood via rule router (mock mode)',
      detail: `Intent: ${action.action}`,
      status: 'done',
    },
  ];

  const executed = await executeAction(accountId, action, steps);

  for (const step of steps.slice(1)) {
    emitAgentEvent(accountId, {
      type: 'assistant',
      agentKey: step.agentKey,
      title: step.title,
      detail: step.detail,
      status: step.status,
    });
  }

  return res.json({
    action: action.action,
    params: action.params,
    reply: executed.reply || action.reply,
    steps,
    clientAction: executed.clientAction,
    llm: llm.info,
  });
});

type PlannedAction = { action: string; params: Record<string, unknown>; reply: string };

async function planWithLLM(text: string, page: string | undefined, locale: string): Promise<PlannedAction | null> {
  try {
    const out = await getLLM().complete(
      `User command (from page "${page ?? 'unknown'}", reply in locale "${locale}"): "${text}"`,
      {
        json: true,
        temperature: 0.2,
        system: [
          'You are the CloseFlow OS command router for a real-estate AI platform.',
          'Map the user command to EXACTLY ONE action and return ONLY JSON:',
          '{"action": <one of: navigate, create_lead, start_scrape, trigger_call, send_message, orchestrate, set_language, answer, clarify>, "params": {...}, "reply": "<short confirmation in the user locale>"}',
          'Params per action:',
          'navigate: {path: one of / /leads /voice /followup /inbox /lead-engine /content /agents /website /billing /settings}',
          'create_lead: {firstName, lastName?, phone?, email?, location?, budget?, intent?}',
          `start_scrape: {personaKey? one of ${LEAD_PERSONAS.map((p) => p.key).join('|')}, query?, city?, country?, source?, maxResults?}`,
          'trigger_call: {leadName, agentKey?}',
          'send_message: {leadName, channel: sms|whatsapp|email, text}',
          'orchestrate: {leadName, goal}',
          'set_language: {locale: en|es|ar|pt|ht}',
          'answer: {} — for questions; put the helpful answer in reply.',
          'clarify: {} — when a REQUIRED param is missing; ask ONE question in reply.',
          'Never invent phone numbers or emails. Prefer clarify over guessing.',
        ].join('\n'),
      },
    );
    const raw = JSON.parse(out) as Record<string, unknown>;
    if (raw.mock) return null;
    const validated = assistantActionSchema.safeParse(raw);
    if (!validated.success) return null;
    return validated.data as PlannedAction;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'assistant LLM planning failed — deterministic fallback');
    return null;
  }
}

/** [MOCK-SAFE] Deterministic English command parser — keeps voice control working keyless. */
function planDeterministic(text: string): PlannedAction {
  const t = text.toLowerCase().trim();

  for (const [name, code] of Object.entries(LOCALES)) {
    if (t.includes(`language to ${name}`) || t === `switch to ${name}` || t.includes(`speak ${name}`)) {
      return { action: 'set_language', params: { locale: code }, reply: `Switching the dashboard to ${name}.` };
    }
  }

  const nav = t.match(/(?:go to|open|show(?: me)?|take me to)\s+(?:the\s+)?([a-z\- ]+?)(?:\s+(?:page|module|screen))?$/);
  if (nav?.[1] && PAGES[nav[1].trim()]) {
    return { action: 'navigate', params: { path: PAGES[nav[1].trim()] }, reply: `Opening ${nav[1].trim()}.` };
  }

  const call = t.match(/call\s+([a-z' ]+?)(?:\s+(?:now|please))?$/);
  if (call?.[1]) {
    return { action: 'trigger_call', params: { leadName: call[1].trim() }, reply: `Queuing a call to ${call[1].trim()}.` };
  }

  const scrape = t.match(/(?:find|scrape|get)\s+(?:me\s+)?(?:new\s+)?(.+?)\s+in\s+([a-z' ]+)$/);
  if (scrape?.[1] && scrape[2]) {
    const what = scrape[1].trim();
    const where = scrape[2].trim();
    const persona = LEAD_PERSONAS.find((p) => what.includes(p.intent) || p.name.toLowerCase().includes(what));
    return {
      action: 'start_scrape',
      params: { query: what, city: where, personaKey: persona?.key },
      reply: `Starting a lead hunt for "${what}" in ${where}.`,
    };
  }

  const addLead = t.match(/(?:add|create)\s+(?:a\s+)?(?:new\s+)?lead\s+(?:named\s+|called\s+)?([a-z' ]+?)(?:\s+(?:phone|number)\s+([+\d][\d\s\-()]{6,}))?$/);
  if (addLead?.[1]) {
    const [firstName, ...rest] = titleCase(addLead[1].trim()).split(/\s+/);
    return {
      action: 'create_lead',
      params: { firstName, lastName: rest.join(' ') || undefined, phone: addLead[2]?.replace(/[\s\-()]/g, '') },
      reply: `Creating lead ${titleCase(addLead[1].trim())}.`,
    };
  }

  if (/^(help|what can you do|commands?)/.test(t)) {
    return {
      action: 'answer',
      params: {},
      reply:
        'Try: "go to leads" · "call Maria" · "add lead John Smith phone +13055551234" · "find luxury buyers in Miami" · "switch language to Spanish". With an LLM key set, I understand free-form requests too.',
    };
  }

  return {
    action: 'clarify',
    params: {},
    reply: 'I did not catch an action there. Try "go to <page>", "call <name>", "add lead <name>", or "find <who> in <city>". Say "help" for the full list.',
  };
}

async function executeAction(
  accountId: string,
  action: PlannedAction,
  steps: AssistantStep[],
): Promise<{ reply?: string; clientAction?: Record<string, unknown> }> {
  const p = action.params as Record<string, string | number | undefined>;
  switch (action.action) {
    case 'navigate':
      return { clientAction: { type: 'navigate', path: String(p.path ?? '/') } };

    case 'set_language':
      return { clientAction: { type: 'set_language', locale: String(p.locale ?? 'en') } };

    case 'create_lead': {
      if (!p.firstName) return { reply: 'I need at least a first name to create a lead.' };
      const lead = await Lead.create({
        accountId,
        firstName: String(p.firstName),
        lastName: p.lastName ? String(p.lastName) : undefined,
        phone: p.phone ? String(p.phone) : undefined,
        email: p.email ? String(p.email) : undefined,
        location: p.location ? String(p.location) : undefined,
        budget: p.budget ? String(p.budget) : undefined,
        intent: ['buyer', 'seller', 'renter', 'investor'].includes(String(p.intent)) ? String(p.intent) : 'unknown',
        source: 'manual',
        consent: { sms: false, call: false, whatsapp: false, email: true },
      });
      steps.push({ agentKey: 'lead-scorer', title: `Lead ${lead.firstName} created`, detail: 'Manual entry via assistant — email consent only until confirmed', status: 'done' });
      return { clientAction: { type: 'refresh', entity: 'leads' } };
    }

    case 'start_scrape': {
      const persona = p.personaKey ? getLeadPersona(String(p.personaKey)) : undefined;
      const query = persona
        ? buildPersonaQuery(persona.queryTemplate, p.city ? String(p.city) : undefined, p.country ? String(p.country) : undefined)
        : [p.query, p.city].filter(Boolean).join(' ');
      if (!query) return { reply: 'Tell me what to look for and where — e.g. "find luxury buyers in Miami".' };
      const account = await Account.findById(accountId).select('enabledModules').lean();
      if (!(account?.enabledModules as string[])?.includes('leadEngine')) {
        return { reply: 'The Lead Engine module is not on your plan — upgrade to Empire to unlock scraping.' };
      }
      const job = await ScrapeJob.create({
        accountId,
        source: persona?.source ?? (p.source ? String(p.source) : 'google-maps'),
        query,
        maxResults: Number(p.maxResults) || persona?.suggestedMaxResults || 25,
        city: p.city ? String(p.city) : undefined,
        country: p.country ? String(p.country) : undefined,
        personaKey: persona?.key,
        filters: persona?.filters,
      });
      await getQueue().enqueue(QUEUES.scrape, { jobId: String(job._id) });
      steps.push({ agentKey: 'lead-engine', title: `Scrape job queued: "${query}"`, detail: `Source ${job.source} · up to ${job.maxResults} prospects`, status: 'done' });
      return { clientAction: { type: 'navigate', path: '/lead-engine' } };
    }

    case 'trigger_call': {
      const lead = await findLeadByName(accountId, String(p.leadName ?? ''));
      if (!lead) return { reply: `I could not find a lead matching "${p.leadName}". Check the Leads page for the exact name.` };
      if (!lead.phone) return { reply: `${lead.firstName} has no phone number on file, so I can't place a call.` };
      const account = await Account.findById(accountId).select('enabledModules').lean();
      if (!(account?.enabledModules as string[])?.includes('voice')) {
        return { reply: 'Voice calling is not on your plan — upgrade to Pro to unlock AI calls.' };
      }
      await getQueue().enqueue(QUEUES.voiceCall, { accountId, leadId: String(lead._id), agentKey: p.agentKey ? String(p.agentKey) : 'speed-to-lead' });
      steps.push({ agentKey: 'speed-to-lead', title: `Call queued to ${lead.firstName}`, detail: 'ComplianceGuard will verify consent & quiet hours before dialing', status: 'done' });
      return { clientAction: { type: 'navigate', path: '/voice' } };
    }

    case 'send_message': {
      const lead = await findLeadByName(accountId, String(p.leadName ?? ''));
      if (!lead) return { reply: `I could not find a lead matching "${p.leadName}".` };
      const channel = ['sms', 'whatsapp', 'email'].includes(String(p.channel)) ? (String(p.channel) as 'sms' | 'whatsapp' | 'email') : 'sms';
      const result = await sendOutbound({
        accountId,
        leadId: String(lead._id),
        channel,
        text: String(p.text ?? 'Just checking in — anything I can help with?'),
        meta: { kind: 'assistant' },
      });
      steps.push({
        agentKey: 'compliance-guard',
        title: result.status === 'blocked' ? `Message blocked: ${result.reason}` : `${channel.toUpperCase()} ${result.status} to ${lead.firstName}`,
        status: result.status === 'blocked' ? 'blocked' : result.ok ? 'done' : 'error',
      });
      if (result.status === 'blocked') {
        return { reply: `ComplianceGuard blocked that message (${result.reason}). This protects you from TCPA violations.` };
      }
      return { clientAction: { type: 'refresh', entity: 'conversations' } };
    }

    case 'orchestrate': {
      const lead = await findLeadByName(accountId, String(p.leadName ?? ''));
      if (!lead) return { reply: `I could not find a lead matching "${p.leadName}".` };
      return {
        clientAction: {
          type: 'orchestrate',
          leadId: String(lead._id),
          goal: String(p.goal ?? 'move this lead forward'),
        },
      };
    }

    case 'answer':
    case 'clarify':
    default:
      return {};
  }
}

/** The rule parser lowercases input — restore human casing for stored names. */
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

async function findLeadByName(accountId: string, name: string) {
  if (!name.trim()) return null;
  const parts = name.trim().split(/\s+/);
  const rx = new RegExp(`^${parts[0]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const candidates = await Lead.find({ accountId, firstName: rx }).limit(5).lean();
  if (parts.length > 1) {
    const lastRx = new RegExp(parts.slice(1).join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return candidates.find((l) => l.lastName && lastRx.test(l.lastName)) ?? candidates[0] ?? null;
  }
  return candidates[0] ?? null;
}
