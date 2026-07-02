import { Router, type Request, type Response } from 'express';
import { orchestrateSchema } from '@truecode/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { requireAuth, requireModule } from '../middleware/auth.js';
import { emitAgentEvent } from '../lib/events.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { sendOutbound } from '../lib/outbound.js';
import { enrollLead } from '../workers/drip.js';
import { AgentRun, Call, Conversation, Lead, Sequence } from '../models.js';

export const orchestratorRouter = Router();
orchestratorRouter.use(requireAuth, requireModule('multiAgent'));

interface NextBestAction {
  type: 'call' | 'sms' | 'whatsapp' | 'email' | 'enrollSequence' | 'book' | 'wait';
  params: Record<string, string>;
  reasoning: string;
  agentPath: string[];
}

/**
 * M9 — POST {leadId, goal} → orchestrator (Python CrewAI service) routes across
 * the 20 crew agents → structured next-best-action → Node EXECUTES it.
 * When services/agents is unreachable, a TS fallback router (same configs,
 * deterministic rules) answers — degraded but honest (flagged in response).
 */
orchestratorRouter.post('/run', async (req: Request, res: Response) => {
  const parsed = orchestrateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const accountId = req.auth!.accountId;
  const { leadId, goal } = parsed.data;

  const lead = await Lead.findOne({ _id: leadId, accountId }).lean();
  if (!lead) return res.status(404).json({ error: 'lead_not_found' });
  const [lastCall, conversations] = await Promise.all([
    Call.findOne({ accountId, leadId }).sort({ createdAt: -1 }).lean(),
    Conversation.find({ accountId, leadId }).lean(),
  ]);

  const run = await AgentRun.create({
    accountId,
    agentKey: 'router',
    input: { leadId, goal },
    status: 'running',
  });
  emitAgentEvent(accountId, {
    type: 'agent:start',
    agentKey: 'router',
    title: `Crew routing: "${goal}"`,
    detail: `Lead ${lead.firstName ?? ''} · status ${lead.status}`,
    status: 'running',
  });

  let action: NextBestAction;
  let source: 'crewai' | 'ts-fallback' = 'ts-fallback';

  if (env.agentsServiceUrl) {
    try {
      const r = await fetch(`${env.agentsServiceUrl}/orchestrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead,
          history: conversations.map((c) => ({ channel: c.channel, messages: c.messages.slice(-5) })),
          transcript: lastCall?.transcript ?? [],
          goal,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (r.ok) {
        action = (await r.json()) as NextBestAction;
        source = 'crewai';
      } else {
        throw new Error(`agents service HTTP ${r.status}`);
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'agents service unreachable — TS fallback router');
      action = fallbackRoute(lead as never, Boolean(lastCall), goal);
    }
  } else {
    action = fallbackRoute(lead as never, Boolean(lastCall), goal);
  }

  // Surface each hop of the agent path so the UI shows the crew working.
  for (const hop of action.agentPath) {
    emitAgentEvent(accountId, {
      type: 'agent:step',
      agentKey: hop,
      title: `${hop} evaluated the lead`,
      detail: hop === action.agentPath[action.agentPath.length - 1] ? action.reasoning.slice(0, 160) : undefined,
      status: 'done',
    });
  }

  // Execute the next-best-action (all outbound paths run ComplianceGuard).
  const executed = await execute(accountId, leadId, action);

  run.output = { action, source } as never;
  run.nextAction = action as never;
  run.status = 'done';
  await run.save();
  emitAgentEvent(accountId, {
    type: 'agent:done',
    agentKey: 'next-best-action',
    title: `Next best action: ${action.type}`,
    detail: action.reasoning.slice(0, 160),
    status: 'done',
  });

  return res.json({ action, executed, source, runId: String(run._id) });
});

orchestratorRouter.get('/runs', async (req: Request, res: Response) => {
  const items = await AgentRun.find({ accountId: req.auth!.accountId }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ items });
});

/** Deterministic mirror of the crew configs — rule-based, clearly labeled. */
function fallbackRoute(
  lead: { status: string; score: number; phone?: string; urgency: string; locale: string },
  hasCallHistory: boolean,
  goal: string,
): NextBestAction {
  const path = ['router', 'compliance-guard', 'lead-scorer', 'next-best-action'];
  if (lead.status === 'dnc')
    return { type: 'wait', params: {}, reasoning: 'Lead is on DNC — no outbound permitted.', agentPath: path };
  if (lead.status === 'new' && lead.phone)
    return {
      type: 'call',
      params: { agentKey: 'speed-to-lead' },
      reasoning: '[TS-FALLBACK] New lead with phone — fastest path to contact is the speed-to-lead qualifier call.',
      agentPath: path,
    };
  if (lead.status === 'contacted' && !hasCallHistory && lead.phone)
    return {
      type: 'call',
      params: { agentKey: 'buyer-qualifier' },
      reasoning: '[TS-FALLBACK] Contacted but never called — qualify by voice.',
      agentPath: [...path, 'buyer-strategist'],
    };
  if (lead.status === 'qualified')
    return {
      type: 'book',
      params: {},
      reasoning: '[TS-FALLBACK] Qualified lead — book the consult (goal: ' + goal + ').',
      agentPath: [...path, 'scheduler'],
    };
  return {
    type: 'enrollSequence',
    params: {},
    reasoning: '[TS-FALLBACK] No immediate action — nurture via follow-up sequence.',
    agentPath: [...path, 'followup-strategist'],
  };
}

async function execute(accountId: string, leadId: string, action: NextBestAction): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'call':
      await getQueue().enqueue(QUEUES.voiceCall, {
        accountId,
        leadId,
        agentKey: action.params.agentKey ?? 'speed-to-lead',
      });
      return { queued: 'voice-call' };
    case 'sms':
    case 'whatsapp':
    case 'email': {
      const result = await sendOutbound({
        accountId,
        leadId,
        channel: action.type,
        text: action.params.text ?? 'Just checking in — anything I can help with?',
        meta: { kind: 'orchestrator' },
      });
      return { sent: result.status };
    }
    case 'enrollSequence': {
      let sequenceId = action.params.sequenceId;
      if (!sequenceId) {
        const seq = await Sequence.findOne({ accountId }).lean();
        if (!seq) return { skipped: 'no_sequence_defined' };
        sequenceId = String(seq._id);
      }
      const enrollmentId = await enrollLead(accountId, leadId, sequenceId);
      return { enrolled: enrollmentId };
    }
    case 'book':
      await getQueue().enqueue(QUEUES.voiceCall, { accountId, leadId, agentKey: 'appointment-booker' });
      return { queued: 'appointment-booker-call' };
    case 'wait':
    default:
      return { waited: true };
  }
}
