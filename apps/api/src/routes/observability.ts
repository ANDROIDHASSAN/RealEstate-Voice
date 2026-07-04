import { Router, type Request, type Response } from 'express';
import { percentile } from '@truecode/shared';
import { requireAuth, requireModule, rbacWrite } from '../middleware/auth.js';
import { withTrace } from '../lib/observability.js';
import { runAssistantCommand } from './assistant.js';
import { Trace } from '../models.js';

/**
 * Observability API — the queryable history behind the dashboard: latency,
 * token cost, per-run span traces, and failure replay.
 */
export const observabilityRouter = Router();
observabilityRouter.use(requireAuth, requireModule('agentOps'), rbacWrite);

observabilityRouter.get('/stats', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const traces = await Trace.find({ accountId }).sort({ createdAt: -1 }).limit(500).select('-spans -input').lean();

  const latencies = traces.map((t) => t.durationMs ?? 0);
  const totalCost = Math.round(traces.reduce((s, t) => s + (t.totalCostUsd ?? 0), 0) * 1e6) / 1e6;
  const totalTokens = traces.reduce((s, t) => s + (t.totalTokens ?? 0), 0);
  const errors = traces.filter((t) => t.status === 'error').length;

  const byKind: Record<string, { count: number; cost: number; tokens: number; avgMs: number }> = {};
  for (const t of traces) {
    const k = String(t.kind);
    const b = byKind[k] ?? { count: 0, cost: 0, tokens: 0, avgMs: 0 };
    b.count += 1;
    b.cost += t.totalCostUsd ?? 0;
    b.tokens += t.totalTokens ?? 0;
    b.avgMs += t.durationMs ?? 0;
    byKind[k] = b;
  }
  for (const k of Object.keys(byKind)) {
    byKind[k]!.avgMs = Math.round(byKind[k]!.avgMs / byKind[k]!.count);
    byKind[k]!.cost = Math.round(byKind[k]!.cost * 1e6) / 1e6;
  }

  // Daily cost trend (oldest → newest).
  const byDay = new Map<string, { cost: number; runs: number; tokens: number }>();
  for (const t of traces) {
    const day = new Date(t.createdAt as Date).toISOString().slice(0, 10);
    const b = byDay.get(day) ?? { cost: 0, runs: 0, tokens: 0 };
    b.cost += t.totalCostUsd ?? 0;
    b.runs += 1;
    b.tokens += t.totalTokens ?? 0;
    byDay.set(day, b);
  }
  const trend = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => ({ day, cost: Math.round(b.cost * 1e6) / 1e6, runs: b.runs, tokens: b.tokens }));

  res.json({
    runs: traces.length,
    totalCostUsd: totalCost,
    totalTokens,
    errorRate: traces.length ? Math.round((errors / traces.length) * 100) : 0,
    latency: {
      avgMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
    },
    byKind,
    trend,
  });
});

observabilityRouter.get('/traces', async (req: Request, res: Response) => {
  const q: Record<string, unknown> = { accountId: req.auth!.accountId };
  if (typeof req.query.kind === 'string') q.kind = req.query.kind;
  if (typeof req.query.status === 'string') q.status = req.query.status;
  const limit = Math.min(100, Number(req.query.limit) || 40);
  const items = await Trace.find(q).sort({ createdAt: -1 }).limit(limit).select('-spans -input').lean();
  res.json({ items });
});

observabilityRouter.get('/traces/:id', async (req: Request, res: Response) => {
  const trace = await Trace.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!trace) return res.status(404).json({ error: 'not_found' });
  res.json({ trace });
});

/**
 * Failure replay — re-runs a captured request from its persisted input, under a
 * fresh trace. Supported for assistant runs (the input is a self-contained
 * command); other kinds return `replayable:false` with an explanation.
 */
observabilityRouter.post('/traces/:id/replay', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const trace = await Trace.findOne({ _id: req.params.id, accountId }).lean();
  if (!trace) return res.status(404).json({ error: 'not_found' });
  if (!trace.replayable || trace.kind !== 'assistant') {
    return res.status(422).json({ error: 'not_replayable', reason: `${trace.kind} traces cannot be replayed from input.` });
  }
  const input = (trace.input ?? {}) as { text?: string; page?: string; locale?: string };
  if (!input.text) return res.status(422).json({ error: 'not_replayable', reason: 'no input captured' });

  let newTraceId: string | null = null;
  const result = await withTrace(
    { accountId, kind: 'assistant', name: `Replay: ${input.text.slice(0, 60)}`, input, replayable: true },
    () => runAssistantCommand(accountId, input.text!, { page: input.page, locale: input.locale }),
    (id) => {
      newTraceId = id;
    },
  );
  res.json({ ok: true, traceId: newTraceId, result });
});
