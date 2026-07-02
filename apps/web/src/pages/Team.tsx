import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { canManageRole, ROLE_META, type TenantRole } from '@truecode/shared';
import { Loader2, ShieldCheck, UserPlus, Users2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/layout/PageHeader';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardTitle } from '../components/ui/card';
import { PageSkeleton } from '../components/ui/skeleton';
import { ErrorState } from '../components/ui/states';
import { api, ApiError } from '../lib/api';
import { initials, timeAgo } from '../lib/utils';
import { useAuthStore, userCan } from '../store/auth';

interface Member {
  _id: string; name: string; email: string; role: TenantRole; platformRole: string;
  status: string; lastLoginAt?: string; createdAt?: string;
}
const ROLE_TONE: Record<TenantRole, 'ink' | 'purple' | 'blue' | 'neutral'> = { owner: 'ink', admin: 'purple', agent: 'blue', viewer: 'neutral' };
const ASSIGNABLE: TenantRole[] = ['admin', 'agent', 'viewer'];

export default function Team() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const myRole = (me?.role ?? 'viewer') as TenantRole;
  const canManage = userCan(me, 'members:manage');
  const [invite, setInvite] = useState<{ open: boolean; name: string; email: string; role: TenantRole }>({ open: false, name: '', email: '', role: 'agent' });
  const [tempPw, setTempPw] = useState<{ email: string; pw: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['members'], queryFn: () => api<{ members: Member[] }>('/members') });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['members'] }); };

  const create = useMutation({
    mutationFn: () => api<{ member: Member; tempPassword?: string }>('/members', { method: 'POST', body: { name: invite.name.trim(), email: invite.email.trim(), role: invite.role } }),
    onSuccess: (r) => { setInvite({ open: false, name: '', email: '', role: 'agent' }); if (r.tempPassword) setTempPw({ email: r.member.email, pw: r.tempPassword }); refresh(); },
    onError: (e) => setError(e instanceof ApiError && e.code === 'email_taken' ? t('team.emailTaken') : e instanceof ApiError && e.code === 'forbidden' ? t('team.forbidden') : t('common.error')),
  });
  const setRole = useMutation({ mutationFn: (a: { id: string; role: TenantRole }) => api(`/members/${a.id}`, { method: 'PATCH', body: { role: a.role } }), onSuccess: refresh });
  const setStatus = useMutation({ mutationFn: (a: { id: string; status: string }) => api(`/members/${a.id}/status`, { method: 'POST', body: { status: a.status } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => api(`/members/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  if (list.isLoading) return <PageSkeleton />;
  if (list.isError) return <ErrorState onRetry={() => void list.refetch()} />;
  const members = list.data!.members;
  const inp = 'h-11 w-full rounded-2xl border border-black/5 bg-surface px-3 text-sm outline-none focus:ring-2 focus:ring-ink/10';

  return (
    <div className="space-y-6">
      <PageHeader title={t('team.title')} subtitle={t('team.subtitle')}
        action={canManage && <Button onClick={() => { setInvite((i) => ({ ...i, open: !i.open })); setError(null); }}>{invite.open ? <X className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />} {t('team.invite')}</Button>} />

      {/* Role legend */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['owner', 'admin', 'agent', 'viewer'] as TenantRole[]).map((r) => (
          <Card key={r} className="p-4">
            <Badge tone={ROLE_TONE[r]}>{ROLE_META[r].label}</Badge>
            <p className="mt-2 text-xs text-ink-soft">{ROLE_META[r].description}</p>
          </Card>
        ))}
      </div>

      {tempPw && (
        <Card tone="yellow" className="flex items-center justify-between gap-3">
          <p className="text-sm"><ShieldCheck className="mr-1 inline h-4 w-4" /> {t('team.tempPwHint')} <strong>{tempPw.email}</strong>: <code className="rounded bg-surface px-2 py-0.5 font-mono">{tempPw.pw}</code></p>
          <button onClick={() => setTempPw(null)}><X className="h-4 w-4" /></button>
        </Card>
      )}

      {invite.open && canManage && (
        <Card className="cf-step-in">
          <CardTitle className="mb-4">{t('team.inviteMember')}</CardTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <input className={inp} placeholder={t('team.name')} value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
            <input className={inp} placeholder={t('team.email')} value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            <select className={inp} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as TenantRole })}>
              {ASSIGNABLE.filter((r) => canManageRole(myRole, r)).map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
            </select>
            <Button onClick={() => invite.name && invite.email && create.mutate()} disabled={create.isPending || !invite.name || !invite.email}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t('team.sendInvite')}
            </Button>
          </div>
          {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
          <p className="mt-2 text-xs text-ink-soft">{t('team.inviteHint')}</p>
        </Card>
      )}

      <Card>
        <CardTitle className="mb-3 flex items-center gap-2"><Users2 className="h-4 w-4" /> {t('team.members')} ({members.length})</CardTitle>
        <ul className="divide-y divide-black/5">
          {members.map((mbr) => {
            const editable = canManage && canManageRole(myRole, mbr.role) && mbr._id !== me?._id;
            return (
              <li key={mbr._id} className="flex flex-wrap items-center gap-3 py-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-card-blue text-sm font-semibold">{initials(mbr.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{mbr.name} {mbr._id === me?._id && <span className="text-xs text-ink-soft">({t('team.you')})</span>}</p>
                  <p className="text-xs text-ink-soft">{mbr.email} · {mbr.lastLoginAt ? `${t('team.lastSeen')} ${timeAgo(mbr.lastLoginAt)}` : t('team.neverLoggedIn')}</p>
                </div>
                {mbr.platformRole === 'superadmin' && <Badge tone="ink"><ShieldCheck className="h-3 w-3" /> {t('team.superadmin')}</Badge>}
                {mbr.status === 'suspended' && <Badge tone="pink">{t('team.suspended')}</Badge>}
                {editable ? (
                  <select value={mbr.role} onChange={(e) => setRole.mutate({ id: mbr._id, role: e.target.value as TenantRole })} className="h-9 rounded-2xl border border-black/5 bg-surface-2 px-2 text-xs outline-none">
                    {(['owner', 'admin', 'agent', 'viewer'] as TenantRole[]).filter((r) => r === mbr.role || canManageRole(myRole, r)).map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
                  </select>
                ) : (
                  <Badge tone={ROLE_TONE[mbr.role]}>{ROLE_META[mbr.role].label}</Badge>
                )}
                {editable && (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: mbr._id, status: mbr.status === 'suspended' ? 'active' : 'suspended' })}>
                      {mbr.status === 'suspended' ? t('team.reactivate') : t('team.suspend')}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-rose-500" onClick={() => remove.mutate(mbr._id)}>{t('team.remove')}</Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
