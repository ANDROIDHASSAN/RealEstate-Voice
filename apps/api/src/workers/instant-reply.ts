import type { Locale } from '@truecode/shared';
import { logger } from '../logger.js';
import { emitAgentEvent } from '../lib/events.js';
import { mergeFields } from '../lib/merge.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { sendOutbound } from '../lib/outbound.js';
import { template } from '../lib/templates.js';
import { Account, Lead } from '../models.js';

/**
 * M1 Instant Reply worker — the wedge. High-priority job fired on lead
 * creation: SMS in the lead's language within seconds, then (if the account
 * has the voice module) trigger the speed-to-lead voice qualifier.
 * Records firstResponseSeconds on the lead.
 */
export function registerInstantReplyWorker(): void {
  const queue = getQueue();
  queue.process(QUEUES.instantReply, async (data) => {
    const leadId = String(data.leadId);
    const accountId = String(data.accountId);

    const [lead, account] = await Promise.all([
      Lead.findOne({ _id: leadId, accountId }),
      Account.findById(accountId),
    ]);
    if (!lead || !account) {
      logger.warn({ leadId }, 'instant-reply: lead or account missing');
      return;
    }

    const locale = (lead.locale ?? account.locale ?? 'en') as Locale;
    const ctx = {
      lead: { firstName: lead.firstName },
      account: { name: account.name, ownerName: account.ownerName ?? account.name },
      interest: lead.propertyInterest || lead.location || defaultInterest(locale),
    };

    const channel = lead.phone ? 'sms' : 'email';
    emitAgentEvent(accountId, {
      type: 'agent:start',
      agentKey: 'instant-reply',
      title: `Instant Reply engaging ${lead.firstName}`,
      detail: `New ${lead.source} lead — replying by ${channel} in ${locale}`,
      status: 'running',
    });
    const result = await sendOutbound({
      accountId,
      leadId,
      channel,
      text: mergeFields(template('instantReply', locale), ctx),
      subject: 'Thanks for reaching out!',
      meta: { kind: 'instant-reply' },
    });

    if (result.ok && lead.firstResponseSeconds === undefined) {
      lead.firstResponseSeconds = Math.max(
        1,
        Math.round((Date.now() - new Date(lead.createdAt as unknown as string).getTime()) / 1000),
      );
      await lead.save();
    }

    // Voice qualifier fires only when the account's plan includes the module.
    if (
      result.ok &&
      lead.phone &&
      (account.enabledModules as string[]).includes('voice') &&
      data.triggerVoice !== false
    ) {
      await getQueue().enqueue(QUEUES.voiceCall, {
        accountId,
        leadId,
        agentKey: 'speed-to-lead',
      });
    }

    logger.info(
      { leadId, channel, status: result.status, firstResponseSeconds: lead.firstResponseSeconds },
      'instant-reply processed',
    );
  });
}

function defaultInterest(locale: Locale): string {
  const map: Record<Locale, string> = {
    en: 'a property',
    es: 'una propiedad',
    ar: 'عقار',
    pt: 'um imóvel',
    ht: 'yon pwopriyete',
  };
  return map[locale];
}
