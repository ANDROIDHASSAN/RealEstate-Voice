import { resend, twilio, whatsapp } from '@closeflow/integrations';
import type { Channel } from '@closeflow/shared';
import { logger } from '../logger.js';
import { Conversation, Lead, UsageLedger } from '../models.js';
import { complianceCheck, type OutboundKind } from './compliance.js';

export interface OutboundResult {
  ok: boolean;
  status: 'sent' | 'mock-sent' | 'blocked' | 'failed';
  reason?: string;
}

/**
 * The ONLY function that sends messages. Every caller (instant reply, drips,
 * WhatsApp auto-reply, campaigns) goes through here → ComplianceGuard → provider.
 */
export async function sendOutbound(opts: {
  accountId: string;
  leadId: string;
  channel: Exclude<Channel, 'instagram'>;
  text: string;
  subject?: string;
  meta?: Record<string, unknown>;
}): Promise<OutboundResult> {
  const kind: OutboundKind = opts.channel;
  const check = await complianceCheck({ accountId: opts.accountId, leadId: opts.leadId, kind });
  if (!check.allowed) {
    await logMessage(opts, 'blocked', { reason: check.reason });
    return { ok: false, status: 'blocked', reason: check.reason };
  }

  const lead = await Lead.findOne({ _id: opts.leadId, accountId: opts.accountId });
  if (!lead) return { ok: false, status: 'failed', reason: 'lead_not_found' };

  let status: OutboundResult['status'] = 'failed';
  let reason: string | undefined;

  try {
    if (opts.channel === 'sms') {
      const res = await twilio.sendSms(lead.phone!, opts.text);
      status = res.status === 'failed' ? 'failed' : res.status;
      reason = res.error;
      if (res.ok)
        await UsageLedger.create({
          accountId: opts.accountId,
          type: 'smsSegments',
          quantity: twilio.segments(opts.text),
        });
    } else if (opts.channel === 'whatsapp') {
      const res = await whatsapp.sendText(lead.phone!, opts.text);
      status = res.status === 'failed' ? 'failed' : res.status;
      reason = res.error;
    } else {
      const res = await resend.sendEmail(lead.email!, opts.subject ?? 'Update from your agent', `<p>${opts.text}</p>`);
      status = res.status === 'failed' ? 'failed' : res.status;
      reason = res.error;
    }
  } catch (err) {
    status = 'failed';
    reason = (err as Error).message;
  }

  await logMessage(opts, status, { reason });
  if (status !== 'failed') {
    lead.lastContactedAt = new Date();
    if (lead.status === 'new') lead.status = 'contacted';
    await lead.save();
  }
  logger.info({ leadId: opts.leadId, channel: opts.channel, status }, 'outbound processed');
  return { ok: status !== 'failed', status, reason };
}

async function logMessage(
  opts: { accountId: string; leadId: string; channel: Exclude<Channel, 'instagram'>; text: string; meta?: Record<string, unknown> },
  status: string,
  extraMeta: Record<string, unknown>,
): Promise<void> {
  await Conversation.findOneAndUpdate(
    { accountId: opts.accountId, leadId: opts.leadId, channel: opts.channel },
    {
      $push: {
        messages: {
          direction: 'outbound',
          text: opts.text,
          ts: new Date(),
          status,
          meta: { ...opts.meta, ...extraMeta },
        },
      },
    },
    { upsert: true },
  );
}
