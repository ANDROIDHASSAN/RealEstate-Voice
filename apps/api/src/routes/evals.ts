import { Router, type Request, type Response } from 'express';
import { evalCaseInputSchema, EVAL_PASS_THRESHOLD, runSuiteSchema } from '@truecode/shared';
import { requireAuth, requireModule, rbacWrite } from '../middleware/auth.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { ensureDefaultEvalCases } from '../workers/evals.js';
import { EvalCase, EvalRun, EvalScore } from '../models.js';

/**
 * Evals API. Separates:
 *  - PRODUCTION scores — every live call auto-scored by the judge (a trend).
 *  - CAPABILITY suites — hard tasks; low pass rates are expected and we push
 *    them up over time.
 *  - REGRESSION suites — near-100% by design; a dip means a prompt change broke
 *    a behavior that used to work.
 */
export const evalsRouter = Router();
evalsRouter.use(requireAuth, requireModule('agentOps'), rbacWrite);

evalsRouter.get('/stats', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const [production, latestRuns, capCases, regCases] = await Promise.all([
    EvalScore.find({ accountId, suite: 'production' }).sort({ createdAt: -1 }).limit(300).lean(),
    EvalRun.find({ accountId }).sort({ createdAt: -1 }).limit(20).lean(),
    EvalCase.countDocuments({ accountId, suite: 'capability' }),
    EvalCase.countDocuments({ accountId, suite: 'regression' }),
  ]);

  const scored = production.length;
  const passed = production.filter((s) => s.pass).length;
  const avgScore = scored ? Math.round(production.reduce((s, r) => s + (r.overall ?? 0), 0) / scored) : 0;

  // Daily production trend (oldest → newest).
  const byDay = new Map<string, { sum: number; n: number; pass: number }>();
  for (const s of production) {
    const day = new Date(s.createdAt as Date).toISOString().slice(0, 10);
    const b = byDay.get(day) ?? { sum: 0, n: 0, pass: 0 };
    b.sum += s.overall ?? 0;
    b.n += 1;
    if (s.pass) b.pass += 1;
    byDay.set(day, b);
  }
  const trend = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, b]) => ({ day, avgScore: Math.round(b.sum / b.n), passRate: Math.round((b.pass / b.n) * 100), count: b.n }));

  const lastBySuite = (suite: string) => latestRuns.find((r) => r.suite === suite);

  res.json({
    threshold: EVAL_PASS_THRESHOLD,
    production: { scored, passed, passRate: scored ? Math.round((passed / scored) * 100) : 0, avgScore, corrected: production.filter((s) => s.corrected).length },
    trend,
    suites: {
      capability: { cases: capCases, lastRun: summarizeRunDoc(lastBySuite('capability')) },
      regression: { cases: regCases, lastRun: summarizeRunDoc(lastBySuite('regression')) },
    },
  });
});

function summarizeRunDoc(r: Record<string, unknown> | undefined) {
  if (!r) return null;
  return {
    id: String(r._id),
    status: r.status,
    passed: r.passed,
    failed: r.failed,
    total: r.total,
    passRate: r.passRate,
    avgScore: r.avgScore,
    createdAt: r.createdAt,
  };
}

evalsRouter.get('/scores', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const suite = typeof req.query.suite === 'string' ? req.query.suite : 'production';
  const limit = Math.min(100, Number(req.query.limit) || 30);
  const items = await EvalScore.find({ accountId, suite }).sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ items });
});

evalsRouter.get('/cases', async (req: Request, res: Response) => {
  const items = await EvalCase.find({ accountId: req.auth!.accountId }).sort({ suite: 1, createdAt: 1 }).lean();
  res.json({ items });
});

evalsRouter.post('/cases', async (req: Request, res: Response) => {
  const parsed = evalCaseInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const created = await EvalCase.create({ accountId: req.auth!.accountId, ...parsed.data });
  res.status(201).json({ case: created });
});

evalsRouter.put('/cases/:id', async (req: Request, res: Response) => {
  const parsed = evalCaseInputSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const updated = await EvalCase.findOneAndUpdate({ _id: req.params.id, accountId: req.auth!.accountId }, parsed.data, { new: true });
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json({ case: updated });
});

evalsRouter.delete('/cases/:id', async (req: Request, res: Response) => {
  const del = await EvalCase.deleteOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!del.deletedCount) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

evalsRouter.post('/cases/seed', async (req: Request, res: Response) => {
  const count = await ensureDefaultEvalCases(req.auth!.accountId);
  res.json({ ok: true, count });
});

evalsRouter.post('/run', async (req: Request, res: Response) => {
  const parsed = runSuiteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const accountId = req.auth!.accountId;
  await ensureDefaultEvalCases(accountId);
  const run = await EvalRun.create({
    accountId,
    suite: parsed.data.suite,
    status: 'running',
    triggeredBy: req.auth!.userId,
    startedAt: new Date().toISOString(),
  });
  await getQueue().enqueue(QUEUES.eval, { kind: 'run-suite', runId: String(run._id), accountId });
  res.status(202).json({ runId: String(run._id) });
});

evalsRouter.get('/runs', async (req: Request, res: Response) => {
  const q: Record<string, unknown> = { accountId: req.auth!.accountId };
  if (typeof req.query.suite === 'string') q.suite = req.query.suite;
  const items = await EvalRun.find(q).sort({ createdAt: -1 }).limit(30).select('-results').lean();
  res.json({ items });
});

evalsRouter.get('/runs/:id', async (req: Request, res: Response) => {
  const run = await EvalRun.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!run) return res.status(404).json({ error: 'not_found' });
  res.json({ run });
});
