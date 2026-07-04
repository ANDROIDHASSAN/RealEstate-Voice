import type { ApprovalAction } from '@truecode/shared';
import { registerApprovalExecutor } from './approvals.js';
import { getQueue, QUEUES } from './queue.js';
import { sendOutbound } from './outbound.js';
import { Lead } from '../models.js';

/**
 * Registers how each approved action resumes from its persisted payload. Kept
 * separate from `approvals.ts` so the gate stays free of outbound/queue imports
 * (no cycles). Called once at boot.
 */
export function registerApprovalExecutors(): void {
  const sendExec =
    () =>
    async (payload: Record<string, unknown>, ctx: { accountId: string }) => {
      const res = await sendOutbound({
        accountId: ctx.accountId,
        leadId: String(payload.leadId),
        channel: payload.channel as 'sms' | 'whatsapp' | 'email',
        text: String(payload.text ?? ''),
        subject: payload.subject ? String(payload.subject) : undefined,
        meta: (payload.meta as Record<string, unknown>) ?? { kind: 'approved' },
        skipApproval: true, // already approved — don't re-gate
      });
      return { status: res.status, ok: res.ok };
    };

  (['send_sms', 'send_whatsapp', 'send_email'] as ApprovalAction[]).forEach((a) => registerApprovalExecutor(a, sendExec()));

  registerApprovalExecutor('bulk_outbound', async (payload, ctx) => {
    const leadIds = (payload.leadIds as string[]) ?? [];
    const channel = payload.channel as 'sms' | 'whatsapp' | 'email';
    let sent = 0;
    let blocked = 0;
    for (const leadId of leadIds) {
      const res = await sendOutbound({
        accountId: ctx.accountId,
        leadId,
        channel,
        text: String(payload.text ?? ''),
        meta: { kind: 'approved-bulk' },
        skipApproval: true,
      });
      if (res.status === 'blocked') blocked += 1;
      else if (res.ok) sent += 1;
    }
    return { sent, blocked, total: leadIds.length };
  });

  registerApprovalExecutor('voice_call', async (payload, ctx) => {
    await getQueue().enqueue(QUEUES.voiceCall, {
      accountId: ctx.accountId,
      leadId: String(payload.leadId),
      agentKey: payload.agentKey ? String(payload.agentKey) : 'speed-to-lead',
    });
    return { queued: 'voice-call' };
  });

  registerApprovalExecutor('ad_launch', async (payload, ctx) => {
    await getQueue().enqueue(QUEUES.adLaunch, { accountId: ctx.accountId, campaignId: String(payload.campaignId) });
    return { queued: 'ad-launch', campaignId: String(payload.campaignId) };
  });

  registerApprovalExecutor('delete_record', async (payload, ctx) => {
    if (payload.model === 'Lead') {
      await Lead.deleteOne({ _id: String(payload.id), accountId: ctx.accountId });
      return { deleted: 'Lead', id: String(payload.id) };
    }
    throw new Error(`unsupported delete target: ${String(payload.model)}`);
  });
}
