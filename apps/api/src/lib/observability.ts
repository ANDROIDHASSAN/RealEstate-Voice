import { AsyncLocalStorage } from 'node:async_hooks';
import {
  estimateCostUsd,
  estimateTokens,
  type SpanType,
  type TraceKind,
  type TraceSpan,
} from '@truecode/shared';
import { getLLM, type LLMCompleteOptions, type LLMProvider } from '@truecode/integrations';
import { logger } from '../logger.js';
import { Trace } from '../models.js';

/**
 * Observability — durable tracing for every AI run.
 *
 * A trace is opened with `withTrace()`, which installs a mutable accumulator in
 * AsyncLocalStorage; anything running inside (LLM calls via `getTracedLLM()`,
 * `recordSpan()` calls, tool timings) attaches to it, and the whole trace is
 * persisted once the callback settles. Traces created outside a request (e.g. a
 * voice call that completes via webhook minutes later) are written directly with
 * `saveTrace()`.
 *
 * Design notes:
 *  - Never throws into business logic. A failed trace write is logged and dropped.
 *  - Token counts are estimated from text when the provider doesn't return usage
 *    (all our current providers), which is honest for a cost dashboard and makes
 *    aiTokens accounting automatic instead of the scattered manual estimates.
 */

interface TraceContext {
  spans: TraceSpan[];
  spanSeq: number;
}

const als = new AsyncLocalStorage<TraceContext>();

let spanCounter = 0;
function nextSpanId(): string {
  spanCounter += 1;
  return `sp_${Date.now().toString(36)}_${spanCounter}`;
}

/** Record a finished span onto the active trace (no-op outside a trace). */
export function recordSpan(span: Omit<TraceSpan, 'id'> & { id?: string }): void {
  const ctx = als.getStore();
  if (!ctx) return;
  ctx.spans.push({ id: span.id ?? nextSpanId(), ...span });
}

/** Time a synchronous-ish unit of work and record it as a span. */
export async function span<T>(
  name: string,
  type: SpanType,
  fn: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  try {
    const out = await fn();
    recordSpan({ name, type, startedAt, durationMs: Date.now() - t0, status: 'ok', meta });
    return out;
  } catch (err) {
    recordSpan({ name, type, startedAt, durationMs: Date.now() - t0, status: 'error', error: (err as Error).message, meta });
    throw err;
  }
}

export interface TraceMeta {
  accountId: string;
  kind: TraceKind;
  name: string;
  refId?: string;
  input?: unknown;
  replayable?: boolean;
}

/** Persist a fully-formed trace (used when spans were gathered out-of-band). */
export async function saveTrace(
  meta: TraceMeta,
  spans: TraceSpan[],
  opts: { status?: 'ok' | 'error'; durationMs?: number; error?: string } = {},
): Promise<string | null> {
  try {
    const totalTokens = spans.reduce((s, sp) => s + (sp.tokensIn ?? 0) + (sp.tokensOut ?? 0), 0);
    const totalCostUsd = Math.round(spans.reduce((s, sp) => s + (sp.costUsd ?? 0), 0) * 1e6) / 1e6;
    const durationMs = opts.durationMs ?? spans.reduce((s, sp) => s + sp.durationMs, 0);
    const doc = await Trace.create({
      accountId: meta.accountId,
      kind: meta.kind,
      refId: meta.refId,
      name: meta.name,
      status: opts.status ?? (spans.some((s) => s.status === 'error') ? 'error' : 'ok'),
      startedAt: spans[0]?.startedAt ?? new Date().toISOString(),
      durationMs,
      totalTokens,
      totalCostUsd,
      spans,
      replayable: meta.replayable ?? false,
      input: meta.input,
      error: opts.error,
    });
    return String(doc._id);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'trace save failed');
    return null;
  }
}

/**
 * Run `fn` inside a fresh trace context and persist the result. Returns whatever
 * `fn` returns; the trace id is delivered via the optional `onTrace` callback so
 * the return type is unchanged for callers that don't care.
 */
export async function withTrace<T>(
  meta: TraceMeta,
  fn: () => Promise<T>,
  onTrace?: (traceId: string | null) => void,
): Promise<T> {
  const ctx: TraceContext = { spans: [], spanSeq: 0 };
  const t0 = Date.now();
  try {
    const out = await als.run(ctx, fn);
    const id = await saveTrace(meta, ctx.spans, { status: 'ok', durationMs: Date.now() - t0 });
    onTrace?.(id);
    return out;
  } catch (err) {
    const id = await saveTrace(meta, ctx.spans, { status: 'error', durationMs: Date.now() - t0, error: (err as Error).message });
    onTrace?.(id);
    throw err;
  }
}

/** Pull the raw model id out of a provider info name like "Gemini (gemini-2.0-flash)". */
function modelFromInfo(name: string): string {
  const m = name.match(/\(([^)]+)\)/);
  return (m?.[1] ?? name).trim();
}

/**
 * The LLM every AgentOps-aware call site should use. Transparent wrapper around
 * `getLLM()` that times each `complete()`, estimates in/out tokens + USD cost,
 * and records an `llm` span on the active trace. Identical interface to the base
 * provider, so it is a drop-in replacement.
 */
export function getTracedLLM(): LLMProvider {
  const base = getLLM();
  return {
    get info() {
      return base.info;
    },
    async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
      const startedAt = new Date().toISOString();
      const t0 = Date.now();
      const model = modelFromInfo(base.info.name);
      const provider = base.info.name.split(' ')[0];
      const tokensIn = estimateTokens((opts?.system ?? '') + prompt);
      try {
        const out = await base.complete(prompt, opts);
        const tokensOut = estimateTokens(out);
        recordSpan({
          name: `LLM · ${model}`,
          type: 'llm',
          startedAt,
          durationMs: Date.now() - t0,
          status: 'ok',
          provider,
          model,
          tokensIn,
          tokensOut,
          costUsd: estimateCostUsd(model, tokensIn, tokensOut),
          meta: { promptChars: prompt.length, live: base.info.live },
        });
        return out;
      } catch (err) {
        recordSpan({
          name: `LLM · ${model}`,
          type: 'llm',
          startedAt,
          durationMs: Date.now() - t0,
          status: 'error',
          provider,
          model,
          tokensIn,
          error: (err as Error).message,
        });
        throw err;
      }
    },
  };
}

export { als as _traceStore };
