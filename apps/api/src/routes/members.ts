import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { canManageRole, ROLE_META, TENANT_ROLES, type TenantRole } from '@truecode/shared';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { User } from '../models.js';

/**
 * Team / member management — tenant RBAC. Any authenticated member can see the
 * team; mutating members requires `members:manage` (owner/admin), and role
 * changes obey canManageRole (only an owner may touch owner/admin roles). The
 * last owner can never be removed, demoted, or suspended — no lockout.
 */
export const membersRouter = Router();
membersRouter.use(requireAuth);

function memberDTO(u: Record<string, unknown>) {
  return {
    _id: String(u._id), name: u.name as string, email: u.email as string, role: u.role as string,
    platformRole: (u.platformRole as string) ?? 'user', status: (u.status as string) ?? 'active',
    lastLoginAt: (u.lastLoginAt as Date | undefined) ?? undefined, createdAt: (u.createdAt as Date | undefined) ?? undefined,
  };
}

membersRouter.get('/roles', (_req: Request, res: Response) => {
  res.json({ roles: TENANT_ROLES.map((r) => ({ key: r, ...ROLE_META[r] })) });
});

membersRouter.get('/', async (req: Request, res: Response) => {
  const users = await User.find({ accountId: req.auth!.accountId }).sort({ createdAt: 1 }).lean();
  res.json({ members: users.map(memberDTO) });
});

async function ownerCount(accountId: string): Promise<number> {
  return User.countDocuments({ accountId, role: 'owner' });
}

const inviteSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  role: z.enum(TENANT_ROLES).default('agent'),
  password: z.string().min(8).max(128).optional(),
});

/** POST / — invite/create a member. Returns a one-time temp password if none given. */
membersRouter.post('/', requirePermission('members:manage'), async (req: Request, res: Response) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const { name, email, role, password } = parsed.data;
  if (!canManageRole(req.auth!.role, role)) return res.status(403).json({ error: 'forbidden', need: 'higher_role' });
  if (await User.findOne({ email })) return res.status(409).json({ error: 'email_taken' });

  const tempPassword = password ?? `${randomBytes(6).toString('base64url')}A1!`;
  const user = await User.create({
    accountId: req.auth!.accountId,
    name, email, role,
    passwordHash: await bcrypt.hash(tempPassword, 12),
    invitedBy: req.auth!.userId,
  });
  return res.status(201).json({ member: memberDTO(user.toObject()), tempPassword: password ? undefined : tempPassword });
});

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  role: z.enum(TENANT_ROLES).optional(),
});

/** PATCH /:id — rename or change a member's role. */
membersRouter.patch('/:id', requirePermission('members:manage'), async (req: Request, res: Response) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const target = await User.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!target) return res.status(404).json({ error: 'not_found' });

  if (parsed.data.role && parsed.data.role !== target.role) {
    // To move a member, the actor must be able to manage BOTH the old and new role.
    if (!canManageRole(req.auth!.role, target.role as TenantRole) || !canManageRole(req.auth!.role, parsed.data.role))
      return res.status(403).json({ error: 'forbidden', need: 'higher_role' });
    // Never demote the last owner.
    if (target.role === 'owner' && parsed.data.role !== 'owner' && (await ownerCount(req.auth!.accountId)) <= 1)
      return res.status(409).json({ error: 'last_owner' });
    target.role = parsed.data.role;
  }
  if (parsed.data.name) target.name = parsed.data.name;
  await target.save();
  return res.json({ member: memberDTO(target.toObject()) });
});

/** POST /:id/status — suspend or reactivate a member. */
membersRouter.post('/:id/status', requirePermission('members:manage'), async (req: Request, res: Response) => {
  const status = (req.body as { status?: string }).status;
  if (status !== 'active' && status !== 'suspended') return res.status(400).json({ error: 'invalid_input' });
  const target = await User.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (String(target._id) === req.auth!.userId) return res.status(409).json({ error: 'cannot_suspend_self' });
  if (!canManageRole(req.auth!.role, target.role as TenantRole)) return res.status(403).json({ error: 'forbidden' });
  if (target.role === 'owner' && status === 'suspended' && (await ownerCount(req.auth!.accountId)) <= 1)
    return res.status(409).json({ error: 'last_owner' });
  target.status = status;
  if (status === 'suspended') target.refreshTokens = [];
  await target.save();
  return res.json({ member: memberDTO(target.toObject()) });
});

/** DELETE /:id — remove a member. */
membersRouter.delete('/:id', requirePermission('members:manage'), async (req: Request, res: Response) => {
  const target = await User.findOne({ _id: req.params.id, accountId: req.auth!.accountId });
  if (!target) return res.status(404).json({ error: 'not_found' });
  if (String(target._id) === req.auth!.userId) return res.status(409).json({ error: 'cannot_remove_self' });
  if (!canManageRole(req.auth!.role, target.role as TenantRole)) return res.status(403).json({ error: 'forbidden' });
  if (target.role === 'owner' && (await ownerCount(req.auth!.accountId)) <= 1) return res.status(409).json({ error: 'last_owner' });
  await target.deleteOne();
  return res.json({ ok: true });
});
