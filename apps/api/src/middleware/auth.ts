import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { can, type ModuleFlag, type Permission, type PlatformRole, type TenantRole } from '@truecode/shared';
import { env } from '../env.js';
import { Account } from '../models.js';

export interface AuthContext {
  userId: string;
  accountId: string;
  role: TenantRole;
  platformRole: PlatformRole;
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
  return { userId: p.userId, accountId: p.accountId, role: p.role, platformRole: p.platformRole ?? 'user' };
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
    req.auth = {
      userId: payload.userId,
      accountId: payload.accountId,
      role: payload.role,
      platformRole: payload.platformRole ?? 'user',
    };
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

/** RBAC — require a specific tenant permission (runs after requireAuth). */
export function requirePermission(permission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!can(req.auth.role, permission)) {
      res.status(403).json({ error: 'forbidden', need: permission, role: req.auth.role });
      return;
    }
    next();
  };
}

/**
 * Read-only guard for a router: GET/HEAD pass for anyone (they already have
 * data:read), but any mutating method requires data:write. This is what makes
 * the `viewer` role read-only across the business modules.
 */
export function rbacWrite(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (!req.auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!can(req.auth.role, 'data:write')) {
    res.status(403).json({ error: 'forbidden', need: 'data:write', role: req.auth.role });
    return;
  }
  next();
}

/** Platform-operator gate — the /admin surface. Runs after requireAuth. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.auth.platformRole !== 'superadmin') {
    res.status(403).json({ error: 'forbidden_superadmin' });
    return;
  }
  next();
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
