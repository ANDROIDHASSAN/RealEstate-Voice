import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { ModuleFlag } from '@closeflow/shared';
import { env } from '../env.js';
import { Account } from '../models.js';

export interface AuthContext {
  userId: string;
  accountId: string;
  role: 'owner' | 'agent' | 'admin';
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

export function signAccessToken(ctx: AuthContext): string {
  return jwt.sign(ctx, env.jwtSecret, { expiresIn: env.accessTtl as jwt.SignOptions['expiresIn'] });
}

export function signRefreshToken(ctx: AuthContext): string {
  return jwt.sign(ctx, env.jwtRefreshSecret, { expiresIn: '30d' });
}

export function verifyRefreshToken(token: string): AuthContext {
  const p = jwt.verify(token, env.jwtRefreshSecret) as AuthContext & Record<string, unknown>;
  return { userId: p.userId, accountId: p.accountId, role: p.role };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), env.jwtSecret) as AuthContext &
      Record<string, unknown>;
    req.auth = { userId: payload.userId, accountId: payload.accountId, role: payload.role };
    next();
  } catch {
    res.status(401).json({ error: 'unauthorized' });
  }
}

/** Module gating — 403 when the account's plan doesn't include the module. */
export function requireModule(flag: ModuleFlag) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const account = await Account.findById(req.auth.accountId).select('enabledModules').lean();
    if (!account) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!(account.enabledModules as string[]).includes(flag)) {
      res.status(403).json({ error: 'module_not_enabled', module: flag });
      return;
    }
    next();
  };
}

/** Simple sliding-window rate limiter (in-memory; per-instance). */
export function rateLimit(opts: { windowMs: number; max: number; key?: (req: Request) => string }) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = (opts.key?.(req) ?? req.ip ?? 'unknown') + ':' + req.path;
    const now = Date.now();
    const windowStart = now - opts.windowMs;
    const list = (hits.get(key) ?? []).filter((t) => t > windowStart);
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10_000) hits.clear(); // memory guard
    if (list.length > opts.max) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  };
}
