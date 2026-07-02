import { Compliance, Lead } from '../models.js';
import { logger } from '../logger.js';

export interface ComplianceCheck {
  allowed: boolean;
  reason?: string;
}

export type OutboundKind = 'sms' | 'call' | 'whatsapp' | 'email';

/**
 * ComplianceGuard — MANDATORY gate before every outbound (PROMPT §11).
 * Checks: DNC list, opt-out status, consent basis, quiet hours (8am–9pm
 * lead-local). Failing = job dropped + logged, never silently sent.
 */
export async function complianceCheck(opts: {
  accountId: string;
  leadId: string;
  kind: OutboundKind;
  timezoneOffsetMinutes?: number;
  /** User-initiated live test call to their own number — quiet hours don't apply. */
  bypassQuietHours?: boolean;
}): Promise<ComplianceCheck> {
  const [lead, compliance] = await Promise.all([
    Lead.findOne({ _id: opts.leadId, accountId: opts.accountId }),
    Compliance.findOne({ accountId: opts.accountId }),
  ]);
  if (!lead) return { allowed: false, reason: 'lead_not_found' };

  const deny = async (reason: string): Promise<ComplianceCheck> => {
    logger.warn({ leadId: opts.leadId, kind: opts.kind, reason }, 'ComplianceGuard blocked outbound');
    if (compliance) {
      compliance.blockedLog.push({ channel: opts.kind, to: lead.phone ?? lead.email ?? 'unknown', reason, ts: new Date() });
      await compliance.save();
    }
    return { allowed: false, reason };
  };

  // 1. Lead-level DNC / opted out
  if (lead.status === 'dnc') return deny('lead_dnc');

  // 2. Account DNC list (phone match)
  const target = opts.kind === 'email' ? lead.email : lead.phone;
  if (!target) return deny('no_contact_method');
  if (compliance?.dncList.includes(target)) return deny('on_dnc_list');

  // 3. Consent basis (TCPA)
  const consentMap: Record<OutboundKind, boolean> = {
    sms: lead.consent?.sms ?? false,
    call: lead.consent?.call ?? false,
    whatsapp: lead.consent?.whatsapp || (lead.consent?.sms ?? false),
    email: lead.consent?.email ?? true,
  };
  if (!consentMap[opts.kind]) return deny(`no_${opts.kind}_consent`);
  if ((opts.kind === 'sms' || opts.kind === 'call') && compliance && !compliance.tcpaConsent)
    return deny('tcpa_consent_disabled');

  // 4. Quiet hours in the lead's local time (email exempt).
  if (opts.kind !== 'email') {
    const start = compliance?.quietHours?.start ?? 8;
    const end = compliance?.quietHours?.end ?? 21;
    const offset = opts.timezoneOffsetMinutes ?? guessOffsetMinutes(lead.locale ?? 'en');
    const localHour = (24 + new Date(Date.now() + offset * 60_000).getUTCHours()) % 24;
    if (localHour < start || localHour >= end) {
      // In tests we allow forcing quiet hours off via env; live self-tests bypass too.
      if (!opts.bypassQuietHours && process.env.COMPLIANCE_IGNORE_QUIET_HOURS !== '1') return deny('quiet_hours');
    }
  }

  return { allowed: true };
}

/** Crude locale→offset guess when the lead has no explicit timezone. */
function guessOffsetMinutes(locale: string): number {
  const map: Record<string, number> = { en: -300, es: -300, pt: -300, ht: -300, ar: 180 };
  return map[locale] ?? -300;
}

/** Handle inbound STOP/opt-out keywords across channels. Returns true if opted out. */
export async function handleOptOut(accountId: string, leadId: string, text: string): Promise<boolean> {
  const stopWords = /^\s*(stop|unsubscribe|alto|parar|توقف|sispann)\s*$/i;
  if (!stopWords.test(text)) return false;
  const lead = await Lead.findOne({ _id: leadId, accountId });
  if (!lead) return false;
  lead.status = 'dnc';
  lead.consent = { sms: false, call: false, whatsapp: false, email: false };
  await lead.save();
  if (lead.phone) {
    await Compliance.updateOne({ accountId }, { $addToSet: { dncList: lead.phone } }, { upsert: true });
  }
  logger.info({ leadId }, 'lead opted out (STOP)');
  return true;
}
