import { Router, type Request, type Response } from 'express';
import { modulesForPlan, PLANS, type ModuleFlag, type PlanKey } from '@truecode/shared';
import { z } from 'zod';
import { logger } from '../logger.js';
import { requireAuth, requireSuperAdmin, signAccessToken, type AuthContext } from '../middleware/auth.js';
import {
  Account, Conversation, Call, Deal, DocumentRecord, Invoice, Lead, LedgerEntry,
  PropertyAnalysis, Quote, User,
} from '../models.js';
import { publicAccount, publicUser } from './auth.js';

/**
 * Super-admin / platform-operator surface. Cross-tenant BY DESIGN — the only
 * place that reads across accounts. Gated by the orthogonal `superadmin`
 * platform role (never a tenant role). Every action is logged.
 */
export const adminRouter = Router();
adminRouter.use(requireAuth, requireSuperAdmin);

/** GET /stats — platform KPIs. */
adminRouter.get('/stats', async (_req: Request, res: Response) => {
  const [accounts, users, leads] = await Promise.all([
    Account.find().select('plan status').lean(),
    User.countDocuments(),
    Lead.countDocuments(),
  ]);
  const byPlan: Record<string, number> = {};
  let estMrr = 0;
  let active = 0;
  let suspended = 0;
  for (const a of accounts) {
    const plan = (a.plan as PlanKey) ?? 'starter';
    byPlan[plan] = (byPlan[plan] ?? 0) + 1;
    if (a.status === 'active') { active += 1; estMrr += PLANS[plan]?.priceMonthly ?? 0; }
    if (a.status === 'suspended') suspended += 1;
  }
  res.json({ totalAccounts: accounts.length, activeAccounts: active, suspendedAccounts: suspended, totalUsers: users, totalLeads: leads, byPlan, estMrr });
});

/** GET /accounts?q= — every tenant, with user + lead counts. */
adminRouter.get('/accounts', async (req: Request, res: Response) => {
  const q = (req.query.q as string | undefined)?.trim();
  const filter = q ? { $or: [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }] } : {};
  const accounts = await Account.find(filter).sort({ createdAt: -1 }).limit(200).lean();
  const ids = accounts.map((a) => a._id);
  const [userCounts, leadCounts] = await Promise.all([
    User.aggregate([{ $match: { accountId: { $in: ids } } }, { $group: { _id: '$accountId', n: { $sum: 1 } } }]),
    Lead.aggregate([{ $match: { accountId: { $in: ids } } }, { $group: { _id: '$accountId', n: { $sum: 1 } } }]),
  ]);
  const uMap = new Map(userCounts.map((r) => [String(r._id), r.n]));
  const lMap = new Map(leadCounts.map((r) => [String(r._id), r.n]));
  res.json({
    accounts: accounts.map((a) => ({
      ...publicAccount(a), userCount: uMap.get(String(a._id)) ?? 0, leadCount: lMap.get(String(a._id)) ?? 0,
    })),
  });
});

/** GET /accounts/:id — one tenant with its members. */
adminRouter.get('/accounts/:id', async (req: Request, res: Response) => {
  const account = await Account.findById(req.params.id).lean();
  if (!account) return res.status(404).json({ error: 'not_found' });
  const members = await User.find({ accountId: account._id }).lean();
  return res.json({ account: publicAccount(account), members: members.map(publicUser) });
});

const patchSchema = z.object({
  plan: z.enum(['starter', 'pro', 'empire', 'ultimate']).optional(),
  status: z.enum(['active', 'past_due', 'canceled', 'suspended']).optional(),
  enabledModules: z.array(z.string()).optional(),
});

/** PATCH /accounts/:id — change a tenant's plan / status / modules. */
adminRouter.patch('/accounts/:id', async (req: Request, res: Response) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const account = await Account.findById(req.params.id);
  if (!account) return res.status(404).json({ error: 'not_found' });
  const { plan, status, enabledModules } = parsed.data;
  if (plan) { account.plan = plan; account.enabledModules = modulesForPlan(plan as PlanKey); }
  if (enabledModules) account.enabledModules = enabledModules as ModuleFlag[];
  if (status) account.status = status;
  await account.save();
  logger.warn({ admin: req.auth!.userId, accountId: req.params.id, plan, status }, 'superadmin changed account');
  return res.json({ account: publicAccount(account.toObject()) });
});

/** POST /accounts/:id/impersonate — issue an access token for the tenant owner. */
adminRouter.post('/accounts/:id/impersonate', async (req: Request, res: Response) => {
  const account = await Account.findById(req.params.id).lean();
  if (!account) return res.status(404).json({ error: 'not_found' });
  const owner = await User.findOne({ accountId: account._id, role: 'owner' }).lean()
    ?? await User.findOne({ accountId: account._id }).lean();
  if (!owner) return res.status(404).json({ error: 'no_user' });
  // Impersonation token is scoped to the tenant and drops superadmin — a support
  // session cannot use the /admin surface. The operator restores their own token
  // client-side to exit.
  const ctx: AuthContext = { userId: String(owner._id), accountId: String(account._id), role: owner.role as AuthContext['role'], platformRole: 'user' };
  const accessToken = signAccessToken(ctx);
  logger.warn({ admin: req.auth!.userId, accountId: req.params.id, as: String(owner._id) }, 'superadmin impersonation');
  return res.json({ accessToken, user: publicUser(owner), account: publicAccount(account) });
});

/** DELETE /accounts/:id — permanently delete a tenant and all its data. */
adminRouter.delete('/accounts/:id', async (req: Request, res: Response) => {
  if (req.params.id === req.auth!.accountId) return res.status(409).json({ error: 'cannot_delete_own_account' });
  const account = await Account.findById(req.params.id);
  if (!account) return res.status(404).json({ error: 'not_found' });
  const accountId = account._id;
  await Promise.all([
    User.deleteMany({ accountId }), Lead.deleteMany({ accountId }), Quote.deleteMany({ accountId }),
    Invoice.deleteMany({ accountId }), Deal.deleteMany({ accountId }), LedgerEntry.deleteMany({ accountId }),
    DocumentRecord.deleteMany({ accountId }), PropertyAnalysis.deleteMany({ accountId }),
    Call.deleteMany({ accountId }), Conversation.deleteMany({ accountId }),
  ]);
  await account.deleteOne();
  logger.warn({ admin: req.auth!.userId, accountId: req.params.id }, 'superadmin deleted account');
  return res.json({ ok: true });
});
