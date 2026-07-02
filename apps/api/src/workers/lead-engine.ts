import { apify } from '@closeflow/integrations';
import { logger } from '../logger.js';
import { emitAgentEvent } from '../lib/events.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { sendOutbound } from '../lib/outbound.js';
import { Lead, ScrapeJob, UsageLedger } from '../models.js';

/**
 * M5 Lead Engine workers.
 * scrape: run Apify (or labeled mock dataset) → dedupe/validate → import leads.
 * campaign: throttled personalized cold outreach (one job per send, spaced out).
 */
export function registerLeadEngineWorkers(): void {
  const queue = getQueue();

  queue.process(QUEUES.scrape, async (data) => {
    const job = await ScrapeJob.findById(String(data.jobId));
    if (!job) return;
    job.status = 'running';
    await job.save();
    emitAgentEvent(String(job.accountId), {
      type: 'scrape',
      agentKey: 'lead-engine',
      title: `Lead Engine scraping "${job.query}"`,
      detail: `Source: ${job.source} · up to ${job.maxResults} prospects`,
      status: 'running',
    });
    try {
      const prospects = await apify.runScrape(
        job.source,
        job.query,
        job.maxResults,
        (job.filters ?? undefined) as { radiusKm?: number; minRating?: number; hasPhone?: boolean } | undefined,
      );
      job.found = prospects.length;

      let imported = 0;
      for (const p of prospects) {
        // Validate: must have a contact method; dedupe on phone/email per account.
        if (!p.phone && !p.email) continue;
        const dup = await Lead.findOne({
          accountId: job.accountId,
          $or: [...(p.phone ? [{ phone: p.phone }] : []), ...(p.email ? [{ email: p.email }] : [])],
        });
        if (dup) continue;
        await Lead.create({
          accountId: job.accountId,
          firstName: p.firstName,
          lastName: p.lastName,
          phone: p.phone,
          email: p.email,
          location: p.location,
          propertyInterest: p.propertyInterest,
          source: 'scrape',
          // Cold-scraped prospects have NO TCPA consent for calls/SMS.
          // Email-first outreach only; ComplianceGuard enforces this.
          consent: { sms: false, call: false, whatsapp: false, email: true },
          intent: job.source === 'zillow-fsbo' || job.source === 'expired' ? 'seller' : 'unknown',
        });
        imported += 1;
      }
      job.imported = imported;
      job.status = 'done';
      await job.save();
      await UsageLedger.create({ accountId: job.accountId, type: 'leadCredits', quantity: imported });

      // Throttled cold outreach: email drip with warm-up spacing (90s apart).
      const fresh = await Lead.find({ accountId: job.accountId, source: 'scrape', status: 'new' })
        .sort({ createdAt: -1 })
        .limit(imported);
      fresh.forEach((lead, i) => {
        void queue.enqueue(
          QUEUES.campaign,
          { accountId: String(job.accountId), leadId: String(lead._id), sourceDetail: job.query },
          { delayMs: i * 90_000, jobId: `camp_${job._id}_${lead._id}` },
        );
      });
      logger.info({ jobId: String(job._id), found: job.found, imported }, 'scrape job done');
      emitAgentEvent(String(job.accountId), {
        type: 'scrape',
        agentKey: 'lead-engine',
        title: `Scrape done — ${job.found} found, ${imported} imported`,
        detail: `"${job.query}" · email-first cold campaign queued`,
        status: 'done',
      });
    } catch (err) {
      job.status = 'error';
      job.error = (err as Error).message;
      await job.save();
      emitAgentEvent(String(job.accountId), {
        type: 'scrape',
        agentKey: 'lead-engine',
        title: `Scrape failed — "${job.query}"`,
        detail: (err as Error).message,
        status: 'error',
      });
      throw err;
    }
  });

  queue.process(QUEUES.campaign, async (data) => {
    const lead = await Lead.findOne({ _id: String(data.leadId), accountId: String(data.accountId) });
    if (!lead || lead.status !== 'new') return;
    // Personalized (TrueReach-style): reference their situation, soft CTA.
    const opener =
      lead.intent === 'seller'
        ? `Hi ${lead.firstName}, I noticed your property in ${lead.location ?? 'the area'} — if it hasn't moved yet, I have buyers actively looking there.`
        : `Hi ${lead.firstName}, I work with buyers and owners around ${lead.location ?? 'your area'} and thought it was worth a quick hello.`;
    await sendOutbound({
      accountId: String(data.accountId),
      leadId: String(lead._id),
      channel: 'email',
      subject: 'Quick question about your property plans',
      text: `${opener} Would a free, no-pressure market snapshot be useful? Just reply and I'll send it over.`,
      meta: { kind: 'cold-campaign', sourceDetail: data.sourceDetail },
    });
  });
}
