import type { Channel, Locale } from '@closeflow/shared';
import { logger } from '../logger.js';
import { mergeFields } from '../lib/merge.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { sendOutbound } from '../lib/outbound.js';
import { Account, DripEnrollment, Lead, Sequence } from '../models.js';

/**
 * M3 Follow-up Autopilot. Each queued job = one enrollment step:
 * {enrollmentId, step}. Sends via the outbound gateway (→ ComplianceGuard),
 * records history, schedules the next step. Replies pause the enrollment.
 */
export function registerDripWorker(): void {
  getQueue().process(QUEUES.drip, async (data) => {
    const enrollmentId = String(data.enrollmentId);
    const step = Number(data.step);

    const enrollment = await DripEnrollment.findById(enrollmentId);
    if (!enrollment || enrollment.status !== 'active' || enrollment.currentStep !== step) return;

    const [sequence, lead, account] = await Promise.all([
      Sequence.findOne({ _id: enrollment.sequenceId, accountId: enrollment.accountId }),
      Lead.findOne({ _id: enrollment.leadId, accountId: enrollment.accountId }),
      Account.findById(enrollment.accountId),
    ]);
    if (!sequence || !lead || !account) return;

    const stepDef = sequence.steps[step];
    if (!stepDef) {
      enrollment.status = 'completed';
      await enrollment.save();
      return;
    }

    const text = mergeFields(stepDef.template ?? '', {
      lead: { firstName: lead.firstName, lastName: lead.lastName ?? '' },
      account: { name: account.name, ownerName: account.ownerName ?? account.name },
      interest: lead.propertyInterest ?? lead.location ?? '',
    });

    const result = await sendOutbound({
      accountId: String(enrollment.accountId),
      leadId: String(enrollment.leadId),
      channel: (stepDef.channel ?? 'sms') as Exclude<Channel, 'instagram'>,
      text,
      subject: `${account.name} — follow-up`,
      meta: { kind: 'drip', sequenceId: String(sequence._id), step },
    });

    enrollment.history.push({
      step,
      channel: stepDef.channel ?? 'sms',
      sentAt: new Date(),
      status: result.status,
    });
    enrollment.currentStep = step + 1;

    const next = sequence.steps[step + 1];
    if (next) {
      const delayMs = Math.max(0, (next.delayHours ?? 0) * 3600 * 1000);
      enrollment.nextRunAt = new Date(Date.now() + delayMs);
      await enrollment.save();
      await getQueue().enqueue(
        QUEUES.drip,
        { enrollmentId, step: step + 1 },
        { delayMs, jobId: `drip_${enrollmentId}_${step + 1}` },
      );
    } else {
      enrollment.status = 'completed';
      enrollment.nextRunAt = undefined;
      await enrollment.save();
    }
    logger.info({ enrollmentId, step, status: result.status }, 'drip step processed');
  });
}

/** Enroll a lead; step 0 fires after its own delay (0 = now). */
export async function enrollLead(accountId: string, leadId: string, sequenceId: string): Promise<string | null> {
  const sequence = await Sequence.findOne({ _id: sequenceId, accountId });
  if (!sequence || sequence.steps.length === 0) return null;
  const existing = await DripEnrollment.findOne({ accountId, leadId, sequenceId, status: 'active' });
  if (existing) return String(existing._id);

  const firstDelayMs = Math.max(0, (sequence.steps[0]!.delayHours ?? 0) * 3600 * 1000);
  const enrollment = await DripEnrollment.create({
    accountId,
    leadId,
    sequenceId,
    currentStep: 0,
    nextRunAt: new Date(Date.now() + firstDelayMs),
    status: 'active',
  });
  await getQueue().enqueue(
    QUEUES.drip,
    { enrollmentId: String(enrollment._id), step: 0 },
    { delayMs: firstDelayMs, jobId: `drip_${enrollment._id}_0` },
  );
  return String(enrollment._id);
}

/** Reply detection → pause active enrollments + notify (conversation flips to human). */
export async function pauseSequencesOnReply(accountId: string, leadId: string): Promise<void> {
  const updated = await DripEnrollment.updateMany(
    { accountId, leadId, status: 'active' },
    { $set: { status: 'paused' } },
  );
  if (updated.modifiedCount > 0)
    logger.info({ leadId, paused: updated.modifiedCount }, 'drip sequences paused on reply');
}
