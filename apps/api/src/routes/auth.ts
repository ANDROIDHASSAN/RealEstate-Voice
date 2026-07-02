import bcrypt from 'bcryptjs';
import { Router, type Request, type Response } from 'express';
import { modulesForPlan, loginSchema, signupSchema } from '@closeflow/shared';
import { env } from '../env.js';
import {
  rateLimit,
  requireAuth,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type AuthContext,
} from '../middleware/auth.js';
import { Account, Compliance, User } from '../models.js';

export const authRouter = Router();

const authLimiter = rateLimit({ windowMs: 60_000, max: 20 });

const REFRESH_COOKIE = 'cf_refresh';

function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: env.nodeEnv === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 3600 * 1000,
    // Path '/' (not '/auth'): the web dev server proxies /api → API and strips
    // the prefix, so refresh requests hit /api/auth/refresh in the browser. A
    // '/auth' cookie path would never match that — sending it for all paths is
    // the robust fix and keeps the session alive across the proxy.
    path: '/',
  });
}

async function issueTokens(res: Response, ctx: AuthContext): Promise<string> {
  const refresh = signRefreshToken(ctx);
  const hash = await bcrypt.hash(refresh.slice(-64), 6);
  await User.updateOne({ _id: ctx.userId }, { $push: { refreshTokens: { $each: [hash], $slice: -5 } } });
  setRefreshCookie(res, refresh);
  return signAccessToken(ctx);
}

authRouter.post('/signup', authLimiter, async (req: Request, res: Response) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const { accountName, name, email, password, phone, locale, timezone } = parsed.data;

  if (await User.findOne({ email })) return res.status(409).json({ error: 'email_taken' });

  const account = await Account.create({
    name: accountName,
    email,
    phone,
    locale,
    timezone,
    ownerName: name,
    plan: 'starter',
    enabledModules: modulesForPlan('starter'),
  });
  await Compliance.create({ accountId: account._id });
  const user = await User.create({
    accountId: account._id,
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: 'owner',
  });

  const ctx: AuthContext = { userId: String(user._id), accountId: String(account._id), role: 'owner' };
  const accessToken = await issueTokens(res, ctx);
  return res.status(201).json({ accessToken, user: publicUser(user), account: publicAccount(account.toObject()) });
});

authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const user = await User.findOne({ email: parsed.data.email });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash)))
    return res.status(401).json({ error: 'invalid_credentials' });

  const account = await Account.findById(user.accountId);
  if (!account || account.status === 'canceled') return res.status(403).json({ error: 'account_inactive' });

  const ctx: AuthContext = { userId: String(user._id), accountId: String(user.accountId), role: user.role };
  const accessToken = await issueTokens(res, ctx);
  return res.json({ accessToken, user: publicUser(user), account: publicAccount(account.toObject()) });
});

authRouter.post('/refresh', async (req: Request, res: Response) => {
  const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ error: 'no_refresh_token' });
  try {
    const ctx = verifyRefreshToken(token);
    const user = await User.findById(ctx.userId);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    // Rotation: verify this refresh token is one we issued, then replace it.
    const matches = await Promise.all(user.refreshTokens.map((h) => bcrypt.compare(token.slice(-64), h)));
    const idx = matches.findIndex(Boolean);
    if (idx === -1) return res.status(401).json({ error: 'refresh_revoked' });
    user.refreshTokens.splice(idx, 1);
    await user.save();
    const accessToken = await issueTokens(res, ctx);
    return res.json({ accessToken });
  } catch {
    return res.status(401).json({ error: 'invalid_refresh_token' });
  }
});

/**
 * Dev/demo-only: seed the demo Empire account into the running DB (needed
 * because local dev uses in-memory Mongo). Disabled in production unless
 * ALLOW_DEMO_SEED=1 (used on the deployed demo).
 */
authRouter.post('/seed-demo', async (_req: Request, res: Response) => {
  if (env.nodeEnv === 'production' && process.env.ALLOW_DEMO_SEED !== '1')
    return res.status(404).json({ error: 'not_found' });
  const { seedDemo } = await import('../seed.js');
  const result = await seedDemo();
  return res.json({ ...result, email: 'demo@closeflow.io', password: 'Demo1234!' });
});

authRouter.post('/logout', requireAuth, async (req: Request, res: Response) => {
  await User.updateOne({ _id: req.auth!.userId }, { $set: { refreshTokens: [] } });
  res.clearCookie(REFRESH_COOKIE, { path: '/' });
  res.json({ ok: true });
});

export function publicUser(user: { _id: unknown; accountId: unknown; name: string; email: string; role: string }) {
  return { _id: String(user._id), accountId: String(user.accountId), name: user.name, email: user.email, role: user.role };
}

export function publicAccount(account: Record<string, unknown>) {
  return {
    _id: String(account._id),
    name: account.name,
    email: account.email,
    phone: account.phone,
    timezone: account.timezone,
    locale: account.locale,
    plan: account.plan,
    enabledModules: account.enabledModules,
    ownerName: account.ownerName,
    websiteSlug: account.websiteSlug,
    status: account.status,
    createdAt: account.createdAt,
  };
}
