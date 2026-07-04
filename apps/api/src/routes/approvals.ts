import { Router, type Request, type Response } from 'express';
import { approvalDecisionSchema, approvalPolicySchema } from '@truecode/shared';
import { requireAuth, requireModule, rbacWrite, requirePermission } from '../middleware/auth.js';
import { decideApproval, getAgentOpsConfig } from '../lib/approvals.js';
import { AgentOpsConfig, Approval } from '../models.js';

/**
 * Approvals API — the human-in-the-loop inbox. Lists parked actions, approves
 * (which resumes the persisted action) or rejects them, and manages the policy
 * (which actions require sign-off) + self-correction settings.
 */
export const approvalsRouter = Router();
approvalsRouter.use(requireAuth, requireModule('agentOps'), rbacWrite);

approvalsRouter.get('/', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const q: Record<string, unknown> = { accountId };
  if (status) q.status = status;
  // Pending first, then most recent.
  const items = await Approval.find(q).sort({ status: 1, createdAt: -1 }).limit(100).lean();
  res.json({ items });
});

approvalsRouter.get('/stats', async (req: Request, res: Response) => {
  const accountId = req.auth!.accountId;
  const all = await Approval.find({ accountId }).select('status action risk createdAt decidedAt').lean();
  const byStatus: Record<string, number> = {};
  const byAction: Record<string, number> = {};
  for (const a of all) {
    byStatus[a.status as string] = (byStatus[a.status as string] ?? 0) + 1;
    byAction[a.action as string] = (byAction[a.action as string] ?? 0) + 1;
  }
  res.json({ total: all.length, pending: byStatus.pending ?? 0, byStatus, byAction });
});

approvalsRouter.get('/policy', async (req: Request, res: Response) => {
  const cfg = await getAgentOpsConfig(req.auth!.accountId);
  res.json(cfg);
});

/** Only admins/owners can change what requires approval (governance). */
approvalsRouter.put('/policy', requirePermission('account:manage'), async (req: Request, res: Response) => {
  const parsed = approvalPolicySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const accountId = req.auth!.accountId;
  const update: Record<string, unknown> = { approvalPolicy: parsed.data.policy };
  if (parsed.data.selfCorrect) update.selfCorrect = parsed.data.selfCorrect;
  await AgentOpsConfig.findOneAndUpdate({ accountId }, { $set: update }, { upsert: true });
  res.json(await getAgentOpsConfig(accountId));
});

approvalsRouter.post('/:id/approve', async (req: Request, res: Response) => {
  const parsed = approvalDecisionSchema.safeParse(req.body ?? {});
  const out = await decideApproval(req.auth!.accountId, req.params.id!, 'approved', req.auth!.userId, parsed.success ? parsed.data.reason : undefined);
  if (out.status === 'not_found') return res.status(404).json({ error: 'not_found' });
  if (out.status === 'already_decided') return res.status(409).json({ error: 'already_decided' });
  res.json(out);
});

approvalsRouter.post('/:id/reject', async (req: Request, res: Response) => {
  const parsed = approvalDecisionSchema.safeParse(req.body ?? {});
  const out = await decideApproval(req.auth!.accountId, req.params.id!, 'rejected', req.auth!.userId, parsed.success ? parsed.data.reason : undefined);
  if (out.status === 'not_found') return res.status(404).json({ error: 'not_found' });
  if (out.status === 'already_decided') return res.status(409).json({ error: 'already_decided' });
  res.json(out);
});
