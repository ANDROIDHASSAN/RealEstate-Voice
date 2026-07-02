import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import {
  assistantPlanSchema,
  buildPersonaQuery,
  getLeadPersona,
  LEAD_PERSONAS,
} from '@closeflow/shared';
import { getLLM } from '@closeflow/integrations';
import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { sendOutbound } from '../lib/outbound.js';
import { Account, Appointment, Lead, ScrapeJob } from '../models.js';

/**
 * CloseFlow Assistant — one natural-language command (typed or voice) in, a
 * multi-step, auditable PLAN out. The LLM only plans (closed, Zod-validated
 * action set) with a live snapshot of the account (leads, stats, modules) as
 * context; Node EXECUTES each step through the same gated paths as the UI
 * (queue + ComplianceGuard). In mock mode a deterministic parser splits
 * compound commands so the assistant stays fully usable without any key.
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
  'follow-up': '/followup', followup: '/followup', inbox: '/inbox', messages: '/inbox',
  'lead engine': '/lead-engine', 'lead-engine': '/lead-engine', scraper: '/lead-engine', prospecting: '/lead-engine',
  content: '/content', agents: '/agents', team: '/agents', 'ai team': '/agents',
  website: '/website', billing: '/billing', plans: '/billing', settings: '/settings',
};

const LOCALES: Record<string, string> = {
  english: 'en', spanish: 'es', español: 'es', arabic: 'ar', عربي: 'ar',
  portuguese: 'pt', português: 'pt', 'haitian creole': 'ht', creole: 'ht', kreyòl: 'ht',
};

// ---------------------------------------------------------------------------
// Context — the assistant's knowledge of the whole account.
// ---------------------------------------------------------------------------

interface LeadBrief {
  id: string;
  name: string;
  status: string;
  source: string;
  location?: string;
  intent: string;
  hasPhone: boolean;
  consentCall: boolean;
}

interface AssistantContext {
  plan: string;
  modules: string[];
  page?: string;
  leadCounts: Record<string, number>;
  totalLeads: number;
  leadsThisWeek: number;
  appointmentsThisWeek: number;
  recentScrapes: { query: string; found: number; imported: number; status: string }[];
  recentLeads: LeadBrief[];
}

async function buildContext(accountId: string, page?: string): Promise<AssistantContext> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [account, byStatus, total, leadsThisWeek, appts, scrapes, recent] = await Promise.all([
    Account.findById(accountId).select('plan enabledModules').lean(),
    Lead.aggregate([
      { $match: { accountId: toId(accountId) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Lead.countDocuments({ accountId }),
    Lead.countDocuments({ accountId, createdAt: { $gte: weekAgo } }),
    Appointment.countDocuments({ accountId, createdAt: { $gte: weekAgo } }),
    ScrapeJob.find({ accountId }).sort({ createdAt: -1 }).limit(3).lean(),
    Lead.find({ accountId }).sort({ createdAt: -1 }).limit(12).lean(),
  ]);

  const leadCounts: Record<string, number> = {};
  for (const row of byStatus) leadCounts[row._id as string] = row.count as number;

  return {
    plan: account?.plan ?? 'starter',
    modules: (account?.enabledModules as string[]) ?? [],
    page,
    leadCounts,
    totalLeads: total,
    leadsThisWeek,
    appointmentsThisWeek: appts,
    recentScrapes: scrapes.map((s) => ({ query: s.query, found: s.found, imported: s.imported, status: s.status })),
    recentLeads: recent.map(briefOf),
  };
}

function briefOf(l: Record<string, unknown>): LeadBrief {
  const consent = (l.consent ?? {}) as { call?: boolean };
  return {
    id: String(l._id),
    name: `${l.firstName ?? ''}${l.lastName ? ` ${l.lastName}` : ''}`.trim(),
    status: String(l.status ?? 'new'),
    source: String(l.source ?? 'manual'),
    location: l.location ? String(l.location) : undefined,
    intent: String(l.intent ?? 'unknown'),
    hasPhone: Boolean(l.phone),
    consentCall: Boolean(consent.call),
  };
}

function toId(id: string) {
  return new mongoose.Types.ObjectId(id);
}

/** Read-only snapshot for the chat UI (so it can greet with real numbers). */
assistantRouter.get('/context', async (req: Request, res: Response) => {
  res.json({ context: await buildContext(req.auth!.accountId, typeof req.query.page === 'string' ? req.query.page : undefined) });
});

// ---------------------------------------------------------------------------
// Command → plan → execute.
// ---------------------------------------------------------------------------

assistantRouter.post('/command', async (req: Request, res: Response) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  const page = typeof req.body?.page === 'string' ? req.body.page : undefined;
  const locale = typeof req.body?.locale === 'string' ? req.body.locale : 'en';
  if (!text || text.length > 1000) return res.status(400).json({ error: 'invalid_input' });
  const accountId = req.auth!.accountId;

  emitAgentEvent(accountId, {
    type: 'assistant',
    agentKey: 'assistant',
    title: 'Assistant heard a command',
    detail: text.slice(0, 140),
    status: 'running',
  });

  const context = await buildContext(accountId, page);
  const llm = getLLM();
  let plan = llm.info.live ? await planWithLLM(text, context, locale) : null;
  if (!plan) plan = planDeterministic(text, context);

  const steps: AssistantStep[] = [
    {
      agentKey: 'router',
      title: llm.info.live ? `Understood via ${llm.info.name}` : 'Understood via rule router (mock mode)',
      detail: `Plan: ${plan.steps.map((s) => s.action).join(' → ')}`,
      status: 'done',
    },
  ];

  const clientActions: Record<string, unknown>[] = [];
  const replies: string[] = [];
  const turn: TurnState = { scrapeQueued: false };

  for (const step of plan.steps) {
    const out = await executeAction(accountId, context, step, steps, turn);
    if (out.reply) replies.push(out.reply);
    if (out.clientAction) clientActions.push(out.clientAction);
  }

  for (const step of steps.slice(1)) {
    emitAgentEvent(accountId, { type: 'assistant', agentKey: step.agentKey, title: step.title, detail: step.detail, status: step.status });
  }

  // Assemble the reply, dropping fragments already covered by an earlier one
  // (the LLM's overall reply often restates a step reply — don't say it twice).
  const finalReply = dedupeFragments([plan.reply, ...replies]);
  // Prefer a single navigate/language action for the client; refreshes merge.
  const primary = clientActions.find((a) => a.type === 'navigate' || a.type === 'set_language' || a.type === 'orchestrate');

  return res.json({
    plan: plan.steps.map((s) => s.action),
    reply: finalReply || "Done. Here's what I did — check the activity feed.",
    steps,
    clientAction: primary,
    clientActions,
    llm: llm.info,
  });
});

type PlannedAction = { action: string; params: Record<string, unknown>; reply: string };
type Plan = { steps: PlannedAction[]; reply: string };

async function planWithLLM(text: string, context: AssistantContext, locale: string): Promise<Plan | null> {
  try {
    const out = await getLLM().complete(
      `USER COMMAND: "${text}"\n\nACCOUNT CONTEXT (JSON):\n${JSON.stringify(context)}`,
      {
        json: true,
        temperature: 0.2,
        maxTokens: 900,
        system: [
          'You are the CloseFlow OS command router + copilot for a real-estate AI platform.',
          `Reply text must be written in locale "${locale}".`,
          'You receive a USER COMMAND and an ACCOUNT CONTEXT snapshot (plan, enabled modules, lead counts, recent named leads with ids, recent scrapes, stats).',
          'Decompose the command into an ORDERED PLAN of one or more steps and return ONLY JSON:',
          '{"steps":[{"action":<action>,"params":{...},"reply":"<short note>"}],"reply":"<overall confirmation, in the user locale, summarising what you did AND anything you could not do and why>"}',
          'Actions and params:',
          'navigate {path: one of / /leads /voice /followup /inbox /lead-engine /content /agents /website /billing /settings}',
          'create_lead {firstName, lastName?, phone?, email?, location?, budget?, intent?}',
          `start_scrape {personaKey? one of [${LEAD_PERSONAS.map((p) => p.key).join(', ')}], query?, city?, country?, source?, maxResults?}`,
          'trigger_call {leadName, agentKey?}  — one named lead',
          'send_message {leadName, channel: sms|whatsapp|email, text}  — one named lead',
          'message_leads {filter:{status?, source?, location?, recent?:true, all?:true}, channel: sms|whatsapp|email, text}  — BULK send to a set',
          'call_leads {filter:{status?, source?, location?, recent?:true, all?:true}, agentKey?}  — BULK calls to a set',
          'orchestrate {leadName, goal}',
          'set_language {locale: en|es|ar|pt|ht}',
          'answer {}  — questions about their data; put the answer (use the CONTEXT numbers) in reply.',
          'clarify {}  — only when a REQUIRED param is truly missing; ask ONE question in reply.',
          'RULES:',
          '- Scraped/cold leads have NO call or SMS consent — ComplianceGuard WILL block SMS/calls to them. If asked to message or call freshly-scraped leads, say the scrape has started and that as leads arrive they get a compliant intro EMAIL automatically, and that calls/SMS are blocked until they opt in. Do not promise blocked actions.',
          '- "them"/"these"/"those" refers to the most recent scrape or the leads matching the just-mentioned filter (use filter, not a fake name).',
          '- If a module is not in enabledModules, do not plan its action — explain the plan gate in reply.',
          '- Never invent phone numbers or emails. Prefer answer/clarify over guessing.',
        ].join('\n'),
      },
    );
    const raw = JSON.parse(out) as Record<string, unknown>;
    if (raw.mock) return null;
    const validated = assistantPlanSchema.safeParse(raw);
    if (!validated.success) return null;
    return validated.data as Plan;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'assistant LLM planning failed — deterministic fallback');
    return null;
  }
}

/** [MOCK-SAFE] Deterministic parser — splits compound commands and keeps voice control working keyless. */
function planDeterministic(text: string, context: AssistantContext): Plan {
  const clauses = text
    .toLowerCase()
    .split(/\s+(?:and(?:\s+also)?|then|,|;|&)\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  const steps: PlannedAction[] = [];
  let scrapedThisTurn = false;

  for (const clause of clauses) {
    const step = parseClause(clause, context, scrapedThisTurn);
    if (!step) continue;
    if (step.action === 'start_scrape') scrapedThisTurn = true;
    steps.push(step);
  }

  if (steps.length === 0) {
    if (/^(help|what can you do|commands?)/.test(text.toLowerCase())) {
      return {
        steps: [{ action: 'answer', params: {}, reply: '' }],
        reply:
          'Try: "go to leads" · "find luxury buyers in Miami and email them" · "call Maria" · "message all new leads" · "how many leads do I have?" · "switch language to Spanish". With an AI key set, I understand free-form, multi-step requests too.',
      };
    }
    return {
      steps: [{ action: 'clarify', params: {}, reply: '' }],
      reply:
        'I did not catch an action there. Try "go to <page>", "find <who> in <city>", "call <name>", "message all new leads", or ask "how many leads do I have?". Say "help" for the full list.',
    };
  }
  return { steps, reply: '' };
}

function parseClause(t: string, context: AssistantContext, scrapedThisTurn: boolean): PlannedAction | null {
  // language
  for (const [name, code] of Object.entries(LOCALES)) {
    if (t.includes(`language to ${name}`) || t === `switch to ${name}` || t.includes(`speak ${name}`)) {
      return { action: 'set_language', params: { locale: code }, reply: `Switching the dashboard to ${name}.` };
    }
  }

  // questions about their data
  if (/how many|count|what.?s my|whats my|do i have|show me the number/.test(t)) {
    return { action: 'answer', params: { question: t }, reply: '' };
  }

  // navigate
  const nav = t.match(/(?:go to|open|show(?: me)?|take me to|navigate to)\s+(?:the\s+)?([a-z\- ]+?)(?:\s+(?:page|module|screen))?$/);
  if (nav?.[1] && PAGES[nav[1].trim()]) {
    return { action: 'navigate', params: { path: PAGES[nav[1].trim()] }, reply: `Opening ${nav[1].trim()}.` };
  }

  // scrape
  const scrape = t.match(/(?:find|scrape|get|give me|pull)\s+(?:me\s+)?(?:some\s+)?(?:new\s+)?(.+?)\s+(?:in|from|around)\s+([a-z' ]+)$/);
  if (scrape?.[1] && scrape[2]) {
    const what = scrape[1].trim();
    const where = titleCase(scrape[2].trim());
    const persona = LEAD_PERSONAS.find((p) => what.includes(p.intent) || p.name.toLowerCase().includes(what) || what.includes(p.key.replace(/-/g, ' ')));
    return {
      action: 'start_scrape',
      params: { query: what, city: where, personaKey: persona?.key },
      reply: `Starting a lead hunt for "${what}" in ${where}.`,
    };
  }

  // bulk message: "message/text/email them|all|new leads|the florida leads"
  const bulkMsg = t.match(/(?:message|text|email|sms|send(?:\s+(?:a\s+)?(?:message|text|email))?)\s+(?:to\s+)?(.+)$/);
  if (bulkMsg?.[1] && /them|these|those|all|every|leads?|prospects?/.test(bulkMsg[1])) {
    const channel = /email/.test(t) ? 'email' : /whatsapp/.test(t) ? 'whatsapp' : 'sms';
    return {
      action: 'message_leads',
      params: { filter: filterFromPhrase(bulkMsg[1], scrapedThisTurn), channel, text: '' },
      reply: '',
    };
  }

  // bulk call: "call them|all|new leads"
  const bulkCall = t.match(/(?:call|dial|ring)\s+(.+)$/);
  if (bulkCall?.[1] && /them|these|those|all|every|leads?|prospects?/.test(bulkCall[1])) {
    return { action: 'call_leads', params: { filter: filterFromPhrase(bulkCall[1], scrapedThisTurn) }, reply: '' };
  }

  // single call: "call Maria"
  const call = t.match(/(?:call|dial|ring)\s+([a-z' ]+?)(?:\s+(?:now|please))?$/);
  if (call?.[1]) {
    return { action: 'trigger_call', params: { leadName: titleCase(call[1].trim()) }, reply: `Queuing a call to ${titleCase(call[1].trim())}.` };
  }

  // create lead
  const addLead = t.match(/(?:add|create)\s+(?:a\s+)?(?:new\s+)?lead\s+(?:named\s+|called\s+)?([a-z' ]+?)(?:\s+(?:phone|number)\s+([+\d][\d\s\-()]{6,}))?$/);
  if (addLead?.[1]) {
    const [firstName, ...rest] = titleCase(addLead[1].trim()).split(/\s+/);
    return {
      action: 'create_lead',
      params: { firstName, lastName: rest.join(' ') || undefined, phone: addLead[2]?.replace(/[\s\-()]/g, '') },
      reply: `Creating lead ${titleCase(addLead[1].trim())}.`,
    };
  }

  return null;
}

/** Turn a natural phrase ("them", "all new leads", "the Florida leads") into a lead filter. */
function filterFromPhrase(phrase: string, scrapedThisTurn: boolean): Record<string, unknown> {
  const p = phrase.toLowerCase();
  if (/them|these|those/.test(p) && scrapedThisTurn) return { source: 'scrape', recent: true };
  const statusMatch = p.match(/\b(new|contacted|qualified|nurture|appointment)\b/);
  if (statusMatch) return { status: statusMatch[1] };
  const inMatch = p.match(/\bin\s+([a-z' ]+)$/);
  if (inMatch?.[1]) return { location: inMatch[1].trim() };
  if (/all|every/.test(p)) return { all: true };
  return { recent: true };
}

// ---------------------------------------------------------------------------
// Execution.
// ---------------------------------------------------------------------------

interface TurnState {
  scrapeQueued: boolean;
}

async function executeAction(
  accountId: string,
  context: AssistantContext,
  action: PlannedAction,
  steps: AssistantStep[],
  turn: TurnState,
): Promise<{ reply?: string; clientAction?: Record<string, unknown> }> {
  const p = action.params as Record<string, string | number | boolean | Record<string, unknown> | undefined>;
  switch (action.action) {
    case 'navigate':
      return { clientAction: { type: 'navigate', path: String(p.path ?? '/') } };

    case 'set_language':
      return { clientAction: { type: 'set_language', locale: String(p.locale ?? 'en') } };

    case 'answer':
      return { reply: action.reply || answerFromContext(String(p.question ?? ''), context) };

    case 'clarify':
      return {};

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
      steps.push({ agentKey: 'lead-scorer', title: `Lead ${lead.firstName} created`, detail: 'Manual entry — email consent only until confirmed', status: 'done' });
      return { reply: `Created lead ${lead.firstName}.`, clientAction: { type: 'refresh', entity: 'leads' } };
    }

    case 'start_scrape': {
      if (!context.modules.includes('leadEngine')) {
        return { reply: 'Lead Engine is not on your plan — upgrade to Empire to unlock prospecting.' };
      }
      const persona = p.personaKey ? getLeadPersona(String(p.personaKey)) : undefined;
      const city = p.city ? String(p.city) : undefined;
      const country = p.country ? String(p.country) : undefined;
      // Build from whatever the planner gave us: an explicit query, or a
      // location alone (a bare "Florida" is a fine Maps seed), or a persona.
      let query = persona
        ? buildPersonaQuery(persona.queryTemplate, city, country)
        : [p.query, p.location, city, country].filter(Boolean).join(' ').trim();
      if (!query && (city || country || p.location)) query = `real estate leads ${[city, country, p.location].filter(Boolean).join(' ')}`.trim();
      if (!query) return { reply: 'Tell me what to look for and where — e.g. "find luxury buyers in Miami".' };
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
      turn.scrapeQueued = true;
      steps.push({ agentKey: 'lead-engine', title: `Scrape queued: "${query}"`, detail: `${job.source} · up to ${job.maxResults} · new leads auto-get a compliant intro email`, status: 'done' });
      return {
        reply: `Started finding "${query}". As leads arrive they'll automatically get a compliant intro email — calls and texts stay blocked until each lead opts in (TCPA).`,
        clientAction: { type: 'navigate', path: '/lead-engine' },
      };
    }

    case 'trigger_call': {
      if (!context.modules.includes('voice')) return { reply: 'Voice calling needs the Pro plan — upgrade to unlock AI calls.' };
      const lead = await findLeadByName(accountId, String(p.leadName ?? ''));
      if (!lead) return { reply: `I couldn't find a lead matching "${p.leadName}". Check the Leads page for the exact name.` };
      if (!lead.phone) return { reply: `${lead.firstName} has no phone number on file, so I can't place a call.` };
      await getQueue().enqueue(QUEUES.voiceCall, { accountId, leadId: String(lead._id), agentKey: p.agentKey ? String(p.agentKey) : 'speed-to-lead' });
      steps.push({ agentKey: 'speed-to-lead', title: `Call queued to ${lead.firstName}`, detail: 'ComplianceGuard verifies consent & quiet hours before dialing', status: 'done' });
      return { reply: `Queued an AI call to ${lead.firstName}.`, clientAction: { type: 'navigate', path: '/voice' } };
    }

    case 'send_message': {
      const lead = await findLeadByName(accountId, String(p.leadName ?? ''));
      if (!lead) return { reply: `I couldn't find a lead matching "${p.leadName}".` };
      const channel = pickChannel(String(p.channel));
      const result = await sendOutbound({
        accountId,
        leadId: String(lead._id),
        channel,
        text: String(p.text || defaultOutreach(lead)),
        meta: { kind: 'assistant' },
      });
      steps.push({
        agentKey: 'compliance-guard',
        title: result.status === 'blocked' ? `Blocked: ${result.reason}` : `${channel.toUpperCase()} ${result.status} → ${lead.firstName}`,
        status: result.status === 'blocked' ? 'blocked' : result.ok ? 'done' : 'error',
      });
      if (result.status === 'blocked') return { reply: `ComplianceGuard blocked the message to ${lead.firstName} (${result.reason}).` };
      return { reply: `Sent a ${channel} to ${lead.firstName}.`, clientAction: { type: 'refresh', entity: 'conversations' } };
    }

    case 'message_leads': {
      const filter = (p.filter as Record<string, unknown>) ?? { recent: true };
      const channel = pickChannel(String(p.channel));
      const leads = await resolveLeads(accountId, filter, 25);
      if (!leads.length) {
        return {
          reply: turn.scrapeQueued
            ? "Those leads are still being scraped — as each one lands it automatically gets a compliant intro email, so there's nothing to send manually."
            : "I couldn't find any leads matching that set yet.",
        };
      }
      let sent = 0;
      let blocked = 0;
      for (const lead of leads) {
        const result = await sendOutbound({
          accountId,
          leadId: String(lead._id),
          channel,
          text: String(p.text || defaultOutreach(lead)),
          meta: { kind: 'assistant-bulk' },
        });
        if (result.status === 'blocked') blocked += 1;
        else if (result.ok) sent += 1;
      }
      steps.push({
        agentKey: 'compliance-guard',
        title: `Bulk ${channel}: ${sent} sent, ${blocked} blocked`,
        detail: `${leads.length} leads in scope`,
        status: blocked && !sent ? 'blocked' : 'done',
      });
      const blockedNote = blocked ? ` ${blocked} were blocked by ComplianceGuard (no ${channel} consent — that's TCPA protection, not a bug).` : '';
      return { reply: `Sent ${sent} ${channel} message${sent === 1 ? '' : 's'}.${blockedNote}`, clientAction: { type: 'refresh', entity: 'conversations' } };
    }

    case 'call_leads': {
      if (!context.modules.includes('voice')) return { reply: 'Voice calling needs the Pro plan.' };
      const filter = (p.filter as Record<string, unknown>) ?? { recent: true };
      const leads = await resolveLeads(accountId, filter, 15);
      const callable = leads.filter((l) => l.phone && (l.consent as { call?: boolean })?.call);
      const skipped = leads.length - callable.length;
      for (const lead of callable) {
        await getQueue().enqueue(QUEUES.voiceCall, { accountId, leadId: String(lead._id), agentKey: p.agentKey ? String(p.agentKey) : 'speed-to-lead' });
      }
      steps.push({
        agentKey: 'speed-to-lead',
        title: `Queued ${callable.length} call${callable.length === 1 ? '' : 's'}`,
        detail: skipped ? `${skipped} skipped (no call consent / no phone)` : undefined,
        status: callable.length ? 'done' : 'blocked',
      });
      const skipNote = skipped ? ` ${skipped} were skipped — they haven't given calling consent (cold/scraped leads can't be called until they opt in).` : '';
      const emptyReply = turn.scrapeQueued
        ? "The scraped leads can't be cold-called — they haven't given calling consent (TCPA). They'll get a compliant email instead, and you can call once they reply."
        : `No leads in that set can be called yet — they need calling consent first.${skipNote}`;
      return {
        reply: callable.length
          ? `Queued AI calls to ${callable.length} lead${callable.length === 1 ? '' : 's'}.${skipNote}`
          : emptyReply,
        clientAction: callable.length ? { type: 'navigate', path: '/voice' } : undefined,
      };
    }

    case 'orchestrate': {
      const lead = await findLeadByName(accountId, String(p.leadName ?? ''));
      if (!lead) return { reply: `I couldn't find a lead matching "${p.leadName}".` };
      return { clientAction: { type: 'orchestrate', leadId: String(lead._id), goal: String(p.goal ?? 'move this lead forward') } };
    }

    default:
      return {};
  }
}

/** Answer data questions from the context snapshot (no LLM needed). */
function answerFromContext(question: string, ctx: AssistantContext): string {
  const q = question.toLowerCase();
  if (/appointment|booking|booked/.test(q)) return `You have ${ctx.appointmentsThisWeek} appointment(s) booked in the last 7 days.`;
  if (/this week|new lead/.test(q)) return `${ctx.leadsThisWeek} new lead(s) came in this week. You have ${ctx.totalLeads} leads total.`;
  const parts = Object.entries(ctx.leadCounts).map(([s, n]) => `${n} ${s}`);
  return `You have ${ctx.totalLeads} leads total${parts.length ? ` — ${parts.join(', ')}` : ''}. ${ctx.leadsThisWeek} arrived this week and ${ctx.appointmentsThisWeek} appointment(s) were booked.`;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Join reply fragments, skipping any that just restate what's already said. */
function dedupeFragments(fragments: string[]): string {
  const kept: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  for (const f of fragments.map((s) => s.trim()).filter(Boolean)) {
    const nf = norm(f);
    if (kept.some((k) => { const nk = norm(k); return nk.includes(nf) || nf.includes(nk); })) continue;
    kept.push(f);
  }
  return kept.join(' ');
}

function pickChannel(raw: string): 'sms' | 'whatsapp' | 'email' {
  return raw === 'whatsapp' || raw === 'email' ? raw : raw === 'sms' ? 'sms' : 'sms';
}

function defaultOutreach(lead: { firstName?: string | null; location?: string | null }): string {
  return `Hi ${lead.firstName ?? 'there'}, this is your agent following up${lead.location ? ` about ${lead.location}` : ''} — happy to answer any questions. Reply anytime!`;
}

/** The rule parser lowercases input — restore human casing for stored names. */
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

async function resolveLeads(accountId: string, filter: Record<string, unknown>, limit: number) {
  const q: Record<string, unknown> = { accountId };
  if (filter.status) q.status = String(filter.status);
  if (filter.source) q.source = String(filter.source);
  if (filter.location) q.location = { $regex: String(filter.location), $options: 'i' };
  if (!filter.all && !filter.status && !filter.source && !filter.location) {
    // "recent" default — leads from the last hour (covers a just-run scrape).
    q.createdAt = { $gte: new Date(Date.now() - 60 * 60 * 1000) };
  }
  return Lead.find(q).sort({ createdAt: -1 }).limit(limit);
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
