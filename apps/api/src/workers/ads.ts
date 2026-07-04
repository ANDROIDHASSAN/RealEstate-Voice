import { metaAds, type AdCampaignSpec } from '@truecode/integrations';
import { logger } from '../logger.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { AdCampaign } from '../models.js';

/**
 * Ads workers — launch a campaign through the Meta Marketing API adapter and
 * sync its insights. Mock mode returns a labeled campaign id + deterministic
 * synthetic metrics so the Ads Manager works end-to-end; live mode creates the
 * real campaign (PAUSED, HOUSING special category) and reads real insights.
 */
export function registerAdWorkers(): void {
  const queue = getQueue();

  queue.process(QUEUES.adLaunch, async (data) => {
    const campaign = await AdCampaign.findById(String(data.campaignId));
    if (!campaign || (campaign.status !== 'draft' && campaign.status !== 'pending_review')) return;

    const targeting = (campaign.targeting as AdCampaignSpec['targeting']) ?? {
      geo: { radiusKm: 16, cities: [], country: 'US' },
      ageMin: 25,
      ageMax: 65,
      genders: ['all'],
      interests: [],
    };
    const spec: AdCampaignSpec = {
      name: campaign.name,
      objective: campaign.objective,
      budgetDailyCents: Math.round(campaign.budgetDaily * 100),
      durationDays: campaign.durationDays,
      creative: {
        headline: campaign.creative?.headline ?? '',
        primaryText: campaign.creative?.primaryText ?? '',
        cta: campaign.creative?.cta ?? 'LEARN_MORE',
        imageUrl: campaign.creative?.imageUrl ?? undefined,
        linkUrl: campaign.creative?.linkUrl ?? undefined,
      },
      targeting,
    };

    const result = await metaAds.createCampaign(spec);
    if (!result.ok) {
      campaign.status = 'failed';
      campaign.error = result.error ?? 'launch failed';
      await campaign.save();
      logger.warn({ campaignId: String(campaign._id), error: campaign.error }, 'ad launch failed');
      return;
    }
    campaign.externalId = result.externalId;
    campaign.stub = result.status === 'mock';
    // Live campaigns are created PAUSED for operator review; mock campaigns go
    // straight to active (labeled stub) so the demo shows a live-looking board.
    campaign.status = result.status === 'live' ? 'pending_review' : 'active';
    campaign.startAt = campaign.startAt ?? new Date();
    campaign.endAt = new Date(Date.now() + campaign.durationDays * 86400000);
    await campaign.save();
    logger.info({ campaignId: String(campaign._id), status: campaign.status, stub: campaign.stub }, 'ad launched');

    await queue.enqueue(QUEUES.adSync, { campaignId: String(campaign._id) });
  });

  queue.process(QUEUES.adSync, async (data) => {
    const campaign = await AdCampaign.findById(String(data.campaignId));
    if (!campaign || !campaign.externalId) return;
    const insights = await metaAds.getInsights(
      campaign.externalId,
      Math.round(campaign.budgetDaily * 100),
      campaign.durationDays,
    );
    campaign.set('metrics', insights);
    campaign.metricsUpdatedAt = new Date();
    await campaign.save();
    logger.info({ campaignId: String(campaign._id), spend: insights.spend, leads: insights.leads }, 'ad insights synced');
  });
}
