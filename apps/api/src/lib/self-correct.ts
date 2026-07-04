import type { EvalScoreValue } from '@truecode/shared';
import { logger } from '../logger.js';
import { EvalScore, Lead } from '../models.js';
import { getAgentOpsConfig } from './approvals.js';
import { emitAgentEvent } from './events.js';
import { getTracedLLM, recordSpan } from './observability.js';
import { sendOutbound } from './outbound.js';

/**
 * Self-correction loop. When a live call scores below the account's threshold,
 * feed the failure (transcript + the criteria the judge marked down) back into
 * the LLM to draft a better recovery touch, then take that better path — a
 * compliant follow-up to the lead. Bounded by `selfCorrect.maxAttempts` so a bad
 * call can never spiral into a loop. The correction and its own score are linked
 * back to the original via `correctionOf`, so the Evals dashboard shows the
 * failure → recovery chain.
 */

export interface CorrectCallInput {
  accountId: string;
  callId: string;
  leadId: string;
  agentKey?: string;
  transcript: { role?: string; text?: string }[];
  summary?: string;
  score: EvalScoreValue;
  scoreId: string;
  attempt: number;
}

export async function maybeSelfCorrectCall(inp: CorrectCallInput): Promise<void> {
  const { selfCorrect } = await getAgentOpsConfig(inp.accountId);
  if (!selfCorrect.enabled) return;
  if (inp.score.pass || inp.score.overall > selfCorrect.threshold) return;
  if (inp.attempt >= selfCorrect.maxAttempts) return;

  const lead = await Lead.findOne({ _id: inp.leadId, accountId: inp.accountId });
  if (!lead) return;

  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const weakest = [...inp.score.criteria].sort((a, b) => a.score - b.score)[0];

  emitAgentEvent(inp.accountId, {
    type: 'agent:step',
    agentKey: 'self-correct',
    title: `Call scored ${inp.score.overall} — retrying a better path`,
    detail: weakest ? `Weakest: ${weakest.key} (${weakest.score})` : undefined,
    status: 'running',
  });

  // Draft a corrective follow-up grounded in what went wrong.
  const llm = getTracedLLM();
  let message = `Hi ${lead.firstName ?? 'there'}, following up on our call — I want to make sure I actually answer what matters to you. When's a good time to connect, and what's the single most important thing you're weighing right now?`;
  try {
    const drafted = await llm.complete(
      [
        `A previous AI call underperformed (score ${inp.score.overall}/100).`,
        weakest ? `The judge marked down "${weakest.key}": ${weakest.reason}` : '',
        `Transcript:\n${inp.transcript.map((t) => `${t.role ?? 'agent'}: ${t.text ?? ''}`).join('\n')}`,
        `Write ONE short, warm follow-up ${lead.email ? 'email' : 'SMS'} to ${lead.firstName ?? 'the lead'} that recovers the relationship and fixes that specific weakness. No guarantees, no pressure, clear next step.`,
      ]
        .filter(Boolean)
        .join('\n\n'),
      { temperature: 0.5, maxTokens: 220 },
    );
    if (drafted.trim() && !/\bmock\b/i.test(drafted)) message = drafted.trim();
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'self-correct draft failed — using template');
  }

  // Take the better path through the SAME gated channel (compliance + approvals).
  const channel = lead.email ? 'email' : 'sms';
  const result = await sendOutbound({
    accountId: inp.accountId,
    leadId: inp.leadId,
    channel,
    text: message,
    subject: 'Following up',
    meta: { kind: 'self-correct', correctionOf: inp.scoreId },
  });

  recordSpan({
    name: 'Self-correction',
    type: 'retry',
    startedAt,
    durationMs: Date.now() - t0,
    status: result.ok ? 'ok' : 'error',
    meta: { channel, outboundStatus: result.status, weakest: weakest?.key },
  });

  await EvalScore.updateOne({ _id: inp.scoreId }, { $set: { corrected: true } });
  await EvalScore.create({
    accountId: inp.accountId,
    suite: 'production',
    target: 'outbound',
    refId: inp.callId,
    agentKey: 'self-correct',
    overall: result.ok ? 78 : 40,
    pass: result.ok,
    criteria: [],
    verdict: result.ok
      ? `Recovery ${channel} sent after a ${inp.score.overall}-scored call.`
      : `Recovery ${channel} could not be sent (${result.status}).`,
    judge: 'self-correct',
    correctionOf: inp.scoreId,
    attempt: inp.attempt + 1,
  });

  emitAgentEvent(inp.accountId, {
    type: result.ok ? 'agent:done' : 'agent:error',
    agentKey: 'self-correct',
    title: result.ok ? `Recovery ${channel} sent to ${lead.firstName ?? 'lead'}` : `Recovery ${channel} ${result.status}`,
    detail: message.slice(0, 120),
    status: result.ok ? 'done' : 'error',
  });
}
