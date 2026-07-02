import { getVoiceProvider, type VoiceCallResult } from '@closeflow/voice';
import { getVoiceAgent, voiceAgentForLocale, type Locale } from '@closeflow/shared';
import { logger } from '../logger.js';
import { complianceCheck } from '../lib/compliance.js';
import { emitAgentEvent } from '../lib/events.js';
import { retrieve, toContextBlock } from '../lib/knowledge.js';
import { getEffectiveAgent } from '../lib/agent-config.js';
import { mergeFields } from '../lib/merge.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { sendOutbound } from '../lib/outbound.js';
import { template } from '../lib/templates.js';
import { Account, Appointment, Call, Lead, UsageLedger } from '../models.js';

/**
 * M2 Voice worker. Job: {accountId, leadId, agentKey}. Runs ComplianceGuard,
 * resolves the agent config + merge fields, dials via VoiceProvider, persists
 * the Call. Completion events (any provider) land in handleVoiceProviderEvent.
 */
export function registerVoiceCallWorker(): void {
  const queue = getQueue();
  // Register the completion handler on the initial provider (for inbound
  // webhooks that may arrive before the first outbound job runs).
  getVoiceProvider().onCallComplete(handleVoiceProviderEvent);

  queue.process(QUEUES.voiceCall, async (data) => {
    // Resolve the provider PER JOB so switching it in Settings/Voice takes
    // effect live (the singleton is rebuilt after resetVoiceProvider()).
    const provider = getVoiceProvider();
    provider.onCallComplete(handleVoiceProviderEvent);

    const accountId = String(data.accountId);
    const leadId = String(data.leadId);
    const requestedKey = String(data.agentKey ?? 'speed-to-lead');

    const [lead, account] = await Promise.all([
      Lead.findOne({ _id: leadId, accountId }),
      Account.findById(accountId),
    ]);
    if (!lead?.phone || !account) return;

    // Language-aware agent selection: honor explicit key, else locale routing.
    const locale = (lead.locale ?? 'en') as Locale;
    const baseAgent =
      getVoiceAgent(requestedKey)?.language === locale
        ? getVoiceAgent(requestedKey)!
        : requestedKey === 'speed-to-lead' && locale !== 'en'
          ? voiceAgentForLocale(locale)
          : (getVoiceAgent(requestedKey) ?? voiceAgentForLocale(locale));

    // Apply the account's Agent Studio config (persona, prompt, STT/LLM/TTS,
    // tools, attached KB) on top of the preset. baseAgent.key is always a
    // preset, so the effective agent is never null here.
    const agent = (await getEffectiveAgent(accountId, baseAgent.key))!;
    const transferRule = baseAgent.transferRule;

    const check = await complianceCheck({ accountId, leadId, kind: 'call', bypassQuietHours: Boolean(data.test) });
    const call = await Call.create({
      accountId,
      leadId,
      direction: 'outbound',
      provider: provider.name,
      agentKey: agent.key,
      status: check.allowed ? 'queued' : 'blocked',
      summary: check.allowed ? undefined : `Blocked by ComplianceGuard: ${check.reason}`,
    });
    if (!check.allowed) {
      logger.warn({ leadId, reason: check.reason }, 'voice call blocked');
      return;
    }

    const ctx = {
      lead: {
        firstName: lead.firstName,
        propertyInterest: lead.propertyInterest ?? 'your property search',
      },
      account: { name: account.name, ownerName: account.ownerName ?? account.name, phone: account.phone ?? '' },
      suggestedSlot: 'tomorrow at 3 PM',
    };

    // RAG: ground the agent in the account's own knowledge base, scoped to what
    // this lead is asking about (interest/location), plus any custom persona.
    const ragQuery = [lead.propertyInterest, lead.location, `${agent.purpose}`].filter(Boolean).join(' ');
    const kb = await retrieve(accountId, ragQuery || 'buyer seller financing process', 4).catch(() => []);
    const knowledge = toContextBlock(kb);

    // Agent-level persona + account-wide instructions both inform the prompt.
    const combinedPrompt = [account.voiceSystemPrompt, agent.systemPrompt].filter(Boolean).join('\n\n') || undefined;

    try {
      const { providerCallId } = await provider.startOutboundCall({
        callRef: String(call._id),
        to: lead.phone,
        agentKey: agent.key,
        locale: agent.language,
        resolvedScript: agent.script.map((line) => mergeFields(line, ctx)),
        voiceId: agent.voiceId,
        tools: agent.tools,
        transferRule: mergeFields(transferRule, ctx),
        firstMessage: mergeFields(agent.firstMessage, ctx),
        systemPrompt: combinedPrompt,
        knowledge: knowledge || undefined,
        transcriber: { provider: agent.transcriberProvider, model: agent.transcriberModel },
        model: { provider: agent.modelProvider, model: agent.modelName, temperature: agent.temperature },
        voice: { provider: agent.voiceProvider, voiceId: agent.voiceId },
        metadata: { accountId, leadId },
      });
      call.providerCallId = providerCallId;
      call.status = 'ringing';
      await call.save();
      emitAgentEvent(accountId, {
        type: 'call',
        agentKey: agent.key,
        title: `${agent.name} is calling ${lead.firstName}`,
        detail: `Dialing ${lead.phone} via ${provider.name}`,
        status: 'running',
      });
      logger.info({ callId: String(call._id), agentKey: agent.key, provider: provider.name }, 'voice call started');
    } catch (err) {
      // A bad/expired provider key (e.g. Vapi 401) must not hang the call at
      // "queued" — mark it failed with the reason so the UI shows what happened.
      const reason = (err as Error).message;
      call.status = 'failed';
      call.summary = `Call could not start via ${provider.name}: ${reason}. Check the provider key in Settings, or switch to Mock to simulate.`;
      await call.save();
      emitAgentEvent(accountId, {
        type: 'call',
        agentKey: agent.key,
        title: `Call failed to start (${provider.name})`,
        detail: reason,
        status: 'error',
      });
      logger.error({ callId: String(call._id), provider: provider.name, err: reason }, 'voice call failed to start');
      // Don't rethrow — retrying a bad key just loops.
    }
  });
}

/** Shared completion path for all providers (mock timer or real webhooks). */
export async function handleVoiceProviderEvent(result: VoiceCallResult): Promise<void> {
  const call = await Call.findById(result.callRef);
  if (!call) {
    logger.warn({ callRef: result.callRef }, 'voice event for unknown call');
    return;
  }
  call.status = result.status;
  call.durationSec = result.durationSec;
  call.transcript = result.transcript as never;
  call.summary = result.summary;
  call.outcome = result.outcome;
  call.recordingUrl = result.recordingUrl;

  const accountId = String(call.accountId);
  const leadId = String(call.leadId);

  await UsageLedger.create({
    accountId,
    type: 'voiceMinutes',
    quantity: Math.max(1, Math.ceil(result.durationSec / 60)),
  });

  const lead = await Lead.findOne({ _id: leadId, accountId });
  if (lead) {
    if (result.outcome === 'booked' || result.outcome === 'qualified') {
      lead.status = result.outcome === 'booked' ? 'appointment' : 'qualified';
      lead.score = Math.max(lead.score, result.outcome === 'booked' ? 90 : 70);
    }
    if (result.extracted.budget) lead.budget = result.extracted.budget;
    if (result.extracted.timeline)
      lead.urgency = result.extracted.timeline.includes('month') ? '1-3mo' : lead.urgency;
    lead.lastContactedAt = new Date();
    await lead.save();
  }

  // Booking: create Appointment + confirmation SMS in the lead's language.
  if (result.outcome === 'booked' && lead) {
    const startsAt = new Date(Date.now() + 24 * 3600 * 1000);
    startsAt.setHours(15, 0, 0, 0);
    const appointment = await Appointment.create({
      accountId,
      leadId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 30 * 60_000),
      type: 'call',
      calendarEventId: `cf_${call._id}`,
    });
    call.bookedAppointmentId = appointment._id;

    const account = await Account.findById(accountId);
    await sendOutbound({
      accountId,
      leadId,
      channel: 'sms',
      text: mergeFields(template('bookingConfirm', (lead.locale ?? 'en') as never), {
        account: { ownerName: account?.ownerName ?? account?.name ?? 'your agent' },
        slot: startsAt.toLocaleString(),
      }),
      meta: { kind: 'booking-confirm', appointmentId: String(appointment._id) },
    });
  }

  await call.save();
  emitAgentEvent(accountId, {
    type: 'call',
    agentKey: call.agentKey,
    title: `Call ${result.status}${result.outcome ? ` — ${result.outcome}` : ''}`,
    detail: result.summary?.slice(0, 140),
    status: result.status === 'failed' ? 'error' : 'done',
  });
  logger.info({ callId: String(call._id), outcome: result.outcome }, 'voice call completed');
}
