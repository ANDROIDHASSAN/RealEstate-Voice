/**
 * RBAC — role-based access control for the multi-tenant platform.
 *
 * Two independent axes:
 *  - Tenant role (owner / admin / agent / viewer): what a user may do WITHIN
 *    their own account. Enforced by permissions.
 *  - Platform role (user / superadmin): cross-tenant, platform-operator access.
 *    A superadmin is NOT a tenant role — it is orthogonal and only unlocks the
 *    /admin surface. Every business query stays account-scoped regardless.
 */

export const TENANT_ROLES = ['owner', 'admin', 'agent', 'viewer'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

export const PLATFORM_ROLES = ['user', 'superadmin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const PERMISSIONS = [
  'members:manage', // invite/remove users, change roles
  'account:manage', // edit account settings, compliance
  'account:billing', // change plan / manage subscription
  'data:write', // create/update/delete business records
  'data:read', // read business records
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<TenantRole, Permission[]> = {
  owner: ['members:manage', 'account:manage', 'account:billing', 'data:write', 'data:read'],
  admin: ['members:manage', 'account:manage', 'account:billing', 'data:write', 'data:read'],
  agent: ['data:write', 'data:read'],
  viewer: ['data:read'],
};

export function can(role: TenantRole, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] ?? []).includes(permission);
}

export interface RoleMeta {
  label: string;
  description: string;
  rank: number; // higher = more privileged
}

export const ROLE_META: Record<TenantRole, RoleMeta> = {
  owner: { label: 'Owner', description: 'Full control including billing and team', rank: 4 },
  admin: { label: 'Admin', description: 'Manage team, billing, settings and all data', rank: 3 },
  agent: { label: 'Agent', description: 'Create and edit leads, deals, quotes, invoices', rank: 2 },
  viewer: { label: 'Viewer', description: 'Read-only access to everything', rank: 1 },
};

/**
 * Whether `actor` may create/modify/remove a member who has (or is being given)
 * `targetRole`. Owner/admin roles can only be managed by an owner — an admin can
 * never mint another admin or touch the owner.
 */
export function canManageRole(actor: TenantRole, targetRole: TenantRole): boolean {
  if (!can(actor, 'members:manage')) return false;
  if (targetRole === 'owner' || targetRole === 'admin') return actor === 'owner';
  return true;
}
