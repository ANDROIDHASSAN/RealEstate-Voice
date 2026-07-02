import { getLLM } from '@truecode/integrations';
import { logger } from '../logger.js';
import { sendOutbound } from '../lib/outbound.js';
import { handleOptOut } from '../lib/compliance.js';
import { pauseSequencesOnReply } from './drip.js';
import { Account, Conversation, Lead } from '../models.js';

const FAQ = `Common answers:
- Financing: we work with trusted multilingual lenders and can refer one.
- Areas: we cover the whole metro area including waterfront and new construction.
- Fees: buyer consultations are free; commissions are discussed at the listing appointment.
- Scheduling: we can book showings within 24 hours.`;

const BUYING_INTENT = /\b(buy|offer|tour|visit|showing|see the (house|property|home)|make an offer|comprar|oferta|visita|شراء|عرض|comprar|oferta|achte)\b/i;

/**
 * M4 WhatsApp auto-reply: inbound message → contextual LLM reply using lead
 * context + FAQ. Hands to human when buying intent is detected.
 */
export async function autoReplyWhatsApp(accountId: string, leadId: string, inboundText: string): Promise<void> {
  const conversation = await Conversation.findOneAndUpdate(
    { accountId, leadId, channel: 'whatsapp' },
    {
      $push: { messages: { direction: 'inbound', text: inboundText, ts: new Date(), status: 'delivered' } },
      $set: { lastInboundAt: new Date() },
    },
    { upsert: true, new: true },
  );

  if (await handleOptOut(accountId, leadId, inboundText)) return;
  await pauseSequencesOnReply(accountId, leadId);

  // Intent → escalate to human, notify, no AI reply beyond handoff message.
  if (BUYING_INTENT.test(inboundText)) {
    conversation.status = 'human';
    await conversation.save();
    await sendOutbound({
      accountId,
      leadId,
      channel: 'whatsapp',
      text: 'Great — connecting you with the agent directly, they will reply here shortly!',
      meta: { kind: 'wa-handoff' },
    });
    logger.info({ leadId }, 'whatsapp handed to human (buying intent)');
    return;
  }

  if (conversation.status === 'human' || conversation.status === 'closed') return;

  const [lead, account] = await Promise.all([
    Lead.findOne({ _id: leadId, accountId }),
    Account.findById(accountId),
  ]);
  if (!lead || !account) return;

  const history = conversation.messages
    .slice(-6)
    .map((m) => `${m.direction === 'inbound' ? 'Lead' : 'Assistant'}: ${m.text}`)
    .join('\n');

  const llm = getLLM();
  let reply: string;
  try {
    reply = await llm.complete(
      `You are the WhatsApp assistant for ${account.name}, a real-estate team. Reply in the lead's language (locale: ${lead.locale}). Keep it under 3 sentences, warm and useful. Never invent listings or prices.\n\n${FAQ}\n\nLead: ${lead.firstName}, interest: ${lead.propertyInterest ?? 'unknown'}, budget: ${lead.budget ?? 'unknown'}.\n\nConversation so far:\n${history}\n\nWrite only the reply text.`,
      { maxTokens: 200 },
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'whatsapp LLM failed');
    reply = 'Thanks for your message! The team will get back to you shortly.';
  }

  await sendOutbound({ accountId, leadId, channel: 'whatsapp', text: reply.trim(), meta: { kind: 'wa-auto-reply', llm: llm.info.name } });
}
