import { Router, type Request, type Response } from 'express';
import { propertyInputSchema, type AnalysisReport, type PropertyInput } from '@truecode/shared';
import { z } from 'zod';
import { rbacWrite, requireAuth, requireModule } from '../middleware/auth.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { answerReportQuestion } from '../lib/property-agents.js';
import { PropertyAnalysis } from '../models.js';

export const propertyAnalysisRouter = Router();
propertyAnalysisRouter.use(requireAuth, requireModule('propertyIntel'), rbacWrite);

/** POST / — submit a property; kicks off the async multi-agent analysis. */
propertyAnalysisRouter.post('/', async (req: Request, res: Response) => {
  const parsed = propertyInputSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const accountId = req.auth!.accountId;
  const input = parsed.data as PropertyInput;

  const doc = await PropertyAnalysis.create({
    accountId,
    createdBy: req.auth!.userId,
    label: `${input.address}, ${input.city}`,
    address: input.address,
    city: input.city,
    state: input.state,
    input,
    status: 'running',
  });

  await getQueue().enqueue(
    QUEUES.propertyAnalysis,
    { accountId, analysisId: String(doc._id) },
    { jobId: `pa_${doc._id}` },
  );

  return res.status(202).json({ id: String(doc._id), status: 'running' });
});

/** GET / — list the account's analyses (summary rows for the dashboard). */
propertyAnalysisRouter.get('/', async (req: Request, res: Response) => {
  const items = await PropertyAnalysis.find({ accountId: req.auth!.accountId })
    .select('label address city state investmentScore grade recommendation riskLevel status enriched watch createdAt input')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json({ items });
});

/** GET /:id — the full analysis + report. */
propertyAnalysisRouter.get('/:id', async (req: Request, res: Response) => {
  const doc = await PropertyAnalysis.findOne({ _id: req.params.id, accountId: req.auth!.accountId }).lean();
  if (!doc) return res.status(404).json({ error: 'not_found' });
  return res.json({ analysis: doc });
});

/** DELETE /:id */
propertyAnalysisRouter.delete('/:id', async (req: Request, res: Response) => {
  const doc = await PropertyAnalysis.findOneAndDelete({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  return res.json({ ok: true });
});

/** PATCH /:id/watch — toggle watchlist tracking. */
propertyAnalysisRouter.patch('/:id/watch', async (req: Request, res: Response) => {
  const watch = Boolean((req.body as { watch?: boolean }).watch);
  const doc = await PropertyAnalysis.findOneAndUpdate(
    { _id: req.params.id, accountId: req.auth!.accountId },
    { $set: { watch } },
    { new: true },
  ).lean();
  if (!doc) return res.status(404).json({ error: 'not_found' });
  return res.json({ watch: doc.watch });
});

const chatSchema = z.object({ question: z.string().min(1).max(1000) });

/** POST /:id/chat — ask the report's AI analyst a question (grounded in the report). */
propertyAnalysisRouter.post('/:id/chat', async (req: Request, res: Response) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const doc = await PropertyAnalysis.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!doc) return res.status(404).json({ error: 'not_found' });
  if (doc.status !== 'done' || !doc.report) return res.status(409).json({ error: 'analysis_not_ready' });

  const { answer, live } = await answerReportQuestion(doc.report as AnalysisReport, parsed.data.question);
  doc.chat.push({ role: 'user', text: parsed.data.question, ts: new Date() } as never);
  doc.chat.push({ role: 'assistant', text: answer, ts: new Date() } as never);
  // Cap thread length to keep the doc small.
  if (doc.chat.length > 40) doc.chat.splice(0, doc.chat.length - 40);
  await doc.save();

  return res.json({ answer, live, chat: doc.chat });
});

/** POST /compare — side-by-side of up to 4 analyses with a highlighted winner. */
const compareSchema = z.object({ ids: z.array(z.string().min(1)).min(2).max(4) });
propertyAnalysisRouter.post('/compare/set', async (req: Request, res: Response) => {
  const parsed = compareSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const docs = await PropertyAnalysis.find({
    _id: { $in: parsed.data.ids },
    accountId: req.auth!.accountId,
    status: 'done',
  }).lean();

  const rows = docs.map((d) => {
    const r = d.report as AnalysisReport;
    return {
      id: String(d._id),
      label: d.label,
      score: d.investmentScore,
      grade: d.grade,
      recommendation: d.recommendation,
      fairValue: r.fairMarketValue.estimated,
      asking: r.input.askingPrice,
      capRate: r.agents.rental.cashFlow.capRatePct,
      cashFlow: r.agents.rental.cashFlow.netMonthly,
      fiveYearRoi: r.agents.strategy.fiveYearRoiPct,
      risk: r.risk.score,
      neighborhood: r.agents.neighborhood.score,
    };
  });

  const best = (sel: (x: (typeof rows)[number]) => number, dir: 'max' | 'min' = 'max') =>
    rows.length
      ? rows.reduce((a, b) => (dir === 'max' ? (sel(b) > sel(a) ? b : a) : sel(b) < sel(a) ? b : a)).id
      : null;

  return res.json({
    rows,
    winners: {
      overall: best((x) => x.score),
      roi: best((x) => x.fiveYearRoi),
      rental: best((x) => x.capRate),
      risk: best((x) => x.risk, 'min'),
      appreciation: best((x) => x.neighborhood),
    },
  });
});
