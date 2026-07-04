import {
  EVAL_PASS_THRESHOLD,
  rubricFor,
  type CriterionScore,
  type EvalScoreValue,
  type EvalTarget,
  type RubricCriterion,
} from '@truecode/shared';
import { logger } from '../logger.js';
import { getTracedLLM, recordSpan } from './observability.js';

/**
 * LLM-as-judge. Scores a target's output against the appropriate rubric and
 * returns a weighted 0–100 score with per-criterion reasons. When no LLM key is
 * set (or the provider returns its mock sentinel) it falls back to a deterministic
 * heuristic so scoring — and therefore evals, self-correction and the production
 * score trend — keeps working keyless and in tests.
 */

export interface JudgeInput {
  target: EvalTarget;
  /** What the target was asked to do (command / brief / call goal). */
  input: string;
  /** What the target produced (reply / transcript / drafted copy). */
  output: string;
  /** The ideal behavior, if known (from an eval case). */
  expectation?: string;
  threshold?: number;
}

function weighted(criteria: CriterionScore[], rubric: RubricCriterion[]): number {
  let sum = 0;
  let wsum = 0;
  for (const c of rubric) {
    const found = criteria.find((x) => x.key === c.key);
    if (!found) continue;
    sum += found.score * c.weight;
    wsum += c.weight;
  }
  return wsum ? Math.round(sum / wsum) : 0;
}

export async function judge(inp: JudgeInput): Promise<EvalScoreValue> {
  const rubric = rubricFor(inp.target);
  const threshold = inp.threshold ?? EVAL_PASS_THRESHOLD;
  const llm = getTracedLLM();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  if (llm.info.live) {
    try {
      const raw = await llm.complete(
        [
          `TARGET UNDER TEST: ${inp.target}`,
          `TASK / INPUT:\n${inp.input}`,
          inp.expectation ? `IDEAL BEHAVIOR:\n${inp.expectation}` : '',
          `ACTUAL OUTPUT:\n${inp.output}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
        {
          json: true,
          temperature: 0,
          maxTokens: 700,
          system: [
            'You are a strict, fair QA judge for a real-estate AI platform. Score the ACTUAL OUTPUT against the rubric.',
            'Each criterion is 0–100. Be critical: reserve 90+ for excellent, 70 is a passing bar, below 50 is a real failure.',
            'Rubric criteria (key — what it measures):',
            ...rubric.map((c) => `- ${c.key}: ${c.label} — ${c.description}`),
            'Return ONLY JSON:',
            '{"criteria":[{"key":"<criterion key>","score":<0-100>,"reason":"<short>"}],"verdict":"<one sentence>"}',
          ].join('\n'),
        },
      );
      const parsed = JSON.parse(raw) as { mock?: boolean; criteria?: CriterionScore[]; verdict?: string };
      if (!parsed.mock && Array.isArray(parsed.criteria) && parsed.criteria.length) {
        const criteria = rubric.map((c) => {
          const f = parsed.criteria!.find((x) => x.key === c.key);
          return { key: c.key, score: clamp(f?.score ?? 60), reason: f?.reason ?? '' };
        });
        const overall = weighted(criteria, rubric);
        recordSpan({ name: 'Judge · LLM', type: 'judge', startedAt, durationMs: Date.now() - t0, status: 'ok', meta: { overall } });
        return { overall, pass: overall >= threshold, criteria, verdict: parsed.verdict ?? '', judge: llm.info.name };
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'LLM judge failed — heuristic fallback');
    }
  }

  const score = heuristicScore(inp, rubric, threshold);
  recordSpan({ name: 'Judge · heuristic', type: 'judge', startedAt, durationMs: Date.now() - t0, status: 'ok', meta: { overall: score.overall } });
  return score;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Deterministic heuristic judge — no LLM. Rewards outcome signals and penalizes
 * red flags (pressure language, unsupported guarantees). Stable for a given
 * input so tests and mock demos are reproducible.
 */
function heuristicScore(inp: JudgeInput, rubric: RubricCriterion[], threshold: number): EvalScoreValue {
  const text = `${inp.output}`.toLowerCase();
  const redFlags = ['guarantee', 'guaranteed', 'best price ever', 'act now or', 'you must', 'no risk'];
  const goodSignals =
    inp.target === 'call'
      ? ['budget', 'timeline', 'book', 'appointment', 'agendo', 'presupuesto', 'qualified']
      : ['happy to', 'no pressure', 'when you', 'reply', 'let me know', 'options'];

  const hasRed = redFlags.some((f) => text.includes(f));
  const goodHits = goodSignals.filter((s) => text.includes(s)).length;
  const lengthOk = inp.output.trim().length >= 20 && inp.output.length <= 2000;

  const base = 68 + Math.min(18, goodHits * 6) + (lengthOk ? 4 : -10) - (hasRed ? 25 : 0);

  const criteria: CriterionScore[] = rubric.map((c) => {
    let s = base;
    if ((c.key === 'compliance' || c.key === 'safety') && hasRed) s -= 15;
    if ((c.key === 'goalCompletion' || c.key === 'correctness') && goodHits === 0) s -= 8;
    return { key: c.key, score: clamp(s), reason: '[heuristic] set an LLM key for judge-quality scoring.' };
  });
  const overall = weighted(criteria, rubric);
  return {
    overall,
    pass: overall >= threshold,
    criteria,
    verdict: hasRed
      ? 'Heuristic: contains pressure/guarantee language — review before use.'
      : goodHits > 0
        ? 'Heuristic: on-track, key signals present.'
        : 'Heuristic: acceptable but thin — few outcome signals.',
    judge: 'heuristic',
  };
}

/** Flatten a call transcript into judged text. */
export function transcriptToText(transcript: { role?: string; text?: string }[] | undefined, summary?: string): string {
  const lines = (transcript ?? []).map((t) => `${t.role ?? 'agent'}: ${t.text ?? ''}`);
  if (summary) lines.push(`\nSUMMARY: ${summary}`);
  return lines.join('\n');
}
