import {
  checkAssertions,
  DEFAULT_EVAL_CASES,
  EVAL_PASS_THRESHOLD,
  summarizeRun,
  type EvalAssertion,
  type EvalCaseResult,
  type EvalTarget,
} from '@truecode/shared';
import { logger } from '../logger.js';
import { emitAgentEvent } from '../lib/events.js';
import { judge, transcriptToText } from '../lib/judge.js';
import { getTracedLLM, withTrace } from '../lib/observability.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { maybeSelfCorrectCall } from '../lib/self-correct.js';
import { getAgentOpsConfig } from '../lib/approvals.js';
import { runAssistantCommand } from '../routes/assistant.js';
import { Call, EvalCase, EvalRun, EvalScore } from '../models.js';

/**
 * Eval worker. Two jobs:
 *  - `score-call`: auto-score a completed voice call with the LLM-judge, store a
 *    `production` EvalScore, then hand off to self-correction if it failed.
 *  - `run-suite`: run every enabled case in a capability/regression suite,
 *    producing an EvalRun with per-case results + aggregate pass rate.
 */
export function registerEvalWorkers(): void {
  const queue = getQueue();
  queue.process(QUEUES.eval, async (data) => {
    const kind = String(data.kind);
    if (kind === 'score-call') await scoreCallJob(String(data.callId));
    else if (kind === 'run-suite') await runSuiteJob(String(data.runId), String(data.accountId));
  });
}

/** Auto-score one completed call and (if failing) trigger self-correction. */
async function scoreCallJob(callId: string): Promise<void> {
  const call = await Call.findById(callId);
  if (!call || (call.status !== 'completed' && call.status !== 'failed')) return;
  const accountId = String(call.accountId);

  const output = transcriptToText(call.transcript as { role?: string; text?: string }[], call.summary ?? undefined);
  if (!output.trim()) return;

  let traceId: string | null = null;
  const score = await withTrace(
    { accountId, kind: 'eval', name: `Auto-score call · ${call.agentKey}`, refId: callId },
    () =>
      judge({
        target: 'call',
        input: `Call goal for agent "${call.agentKey}". Outcome: ${call.outcome ?? 'unknown'}.`,
        output,
      }),
    (id) => {
      traceId = id;
    },
  );

  const saved = await EvalScore.create({
    accountId,
    suite: 'production',
    target: 'call',
    refId: callId,
    agentKey: call.agentKey,
    overall: score.overall,
    pass: score.pass,
    criteria: score.criteria,
    verdict: score.verdict,
    judge: score.judge,
    traceId: traceId ?? undefined,
    attempt: 0,
  });

  emitAgentEvent(accountId, {
    type: score.pass ? 'agent:done' : 'agent:error',
    agentKey: 'eval-judge',
    title: `Call scored ${score.overall}/100 (${score.pass ? 'pass' : 'fail'})`,
    detail: score.verdict,
    status: score.pass ? 'done' : 'error',
  });

  if (!score.pass) {
    await maybeSelfCorrectCall({
      accountId,
      callId,
      leadId: String(call.leadId),
      agentKey: call.agentKey,
      transcript: call.transcript as { role?: string; text?: string }[],
      summary: call.summary ?? undefined,
      score,
      scoreId: String(saved._id),
      attempt: 0,
    });
  }
}

/** Produce the output of the system-under-test for one eval case. */
async function generateForTarget(accountId: string, target: EvalTarget, input: string): Promise<string> {
  if (target === 'call') return input; // the input IS the transcript to judge
  if (target === 'assistant') {
    const r = await runAssistantCommand(accountId, input);
    const nav = r.clientAction?.path ? ` || NAV: ${String(r.clientAction.path)}` : '';
    return `${r.reply} || PLAN: ${r.plan.join(', ')}${nav}`;
  }
  // outbound / agent-run — generate copy/decision via the traced LLM.
  const system =
    target === 'outbound'
      ? 'You are a top real-estate agent writing outbound copy. Warm, concise, compliant (clear opt-out, no guarantees, no pressure). Return only the message.'
      : 'You are the next-best-action router for a real-estate CRM. Decide the single best next step and explain briefly.';
  return getTracedLLM().complete(input, { system, maxTokens: 260, temperature: 0.5 });
}

async function runCase(accountId: string, c: {
  _id: unknown; name: string; target: EvalTarget; input: string; assertions: EvalAssertion[]; expectation?: string;
}): Promise<EvalCaseResult> {
  const t0 = Date.now();
  let traceId: string | undefined;
  let output = '';
  let score;
  await withTrace(
    { accountId, kind: 'eval', name: `Eval: ${c.name}`, input: { input: c.input }, replayable: true },
    async () => {
      output = await generateForTarget(accountId, c.target, c.input);
      score = await judge({ target: c.target, input: c.input, output, expectation: c.expectation });
    },
    (id) => {
      traceId = id ?? undefined;
    },
  );
  const s = score!;
  const { passed, total } = checkAssertions(output, c.assertions ?? [], s.overall);
  const pass = (c.assertions?.length ?? 0) > 0 ? passed === total : s.pass;
  return {
    caseId: String(c._id),
    name: c.name,
    target: c.target,
    output: output.slice(0, 2000),
    score: s,
    assertionsPassed: passed,
    assertionsTotal: total,
    pass,
    durationMs: Date.now() - t0,
    traceId,
  };
}

async function runSuiteJob(runId: string, accountId: string): Promise<void> {
  const run = await EvalRun.findById(runId);
  if (!run) return;
  const suite = run.suite as 'capability' | 'regression';
  const t0 = Date.now();
  try {
    const cases = await EvalCase.find({ accountId, suite, enabled: true }).lean();
    const results: EvalCaseResult[] = [];
    for (const c of cases) {
      results.push(
        await runCase(accountId, {
          _id: c._id,
          name: c.name,
          target: c.target as EvalTarget,
          input: c.input,
          assertions: (c.assertions ?? []) as EvalAssertion[],
          expectation: c.expectation ?? undefined,
        }),
      );
    }
    const agg = summarizeRun(results);
    run.set({ ...agg, results, status: 'done', durationMs: Date.now() - t0 });
    await run.save();
    emitAgentEvent(accountId, {
      type: agg.failed ? 'agent:error' : 'agent:done',
      agentKey: 'eval-suite',
      title: `${suite} suite: ${agg.passed}/${agg.total} passed (${agg.passRate}%)`,
      detail: suite === 'regression' && agg.failed ? 'Regression detected — a previously-passing behavior broke.' : `avg score ${agg.avgScore}`,
      status: agg.failed && suite === 'regression' ? 'error' : 'done',
    });
  } catch (err) {
    run.set({ status: 'error', note: (err as Error).message, durationMs: Date.now() - t0 });
    await run.save();
    logger.error({ err: (err as Error).message, runId }, 'eval suite run failed');
  }
}

/** Idempotently seed an account's default capability + regression cases. */
export async function ensureDefaultEvalCases(accountId: string): Promise<number> {
  const count = await EvalCase.countDocuments({ accountId });
  if (count > 0) return count;
  await EvalCase.insertMany(DEFAULT_EVAL_CASES.map((c) => ({ ...c, accountId })));
  return DEFAULT_EVAL_CASES.length;
}

export { EVAL_PASS_THRESHOLD, getAgentOpsConfig };
