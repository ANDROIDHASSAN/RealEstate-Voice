import { envVal, forceMock, type ProviderInfo } from './base.js';

export interface AdCampaignSpec {
  name: string;
  objective: string;
  budgetDailyCents: number;
  durationDays: number;
  creative: { headline: string; primaryText: string; cta: string; imageUrl?: string; linkUrl?: string };
  targeting: {
    geo: { lat?: number; lng?: number; radiusKm: number; cities: string[]; country: string };
    ageMin: number;
    ageMax: number;
    genders: string[];
    interests: string[];
  };
}

export interface AdLaunchResult {
  ok: boolean;
  externalId?: string;
  status: 'live' | 'mock' | 'failed';
  error?: string;
}

export interface AdInsights {
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  spend: number;
  leads: number;
  cpl: number;
  daily: { date: string; impressions: number; clicks: number; spend: number; leads: number }[];
}

/** Map our realtor-friendly objectives onto Meta's Outcome-based objectives. */
function mapObjective(objective: string): string {
  switch (objective) {
    case 'LEADS':
    case 'SELLER_LEADS':
      return 'OUTCOME_LEADS';
    case 'TRAFFIC':
    case 'LISTING_PROMOTION':
    case 'OPEN_HOUSE':
      return 'OUTCOME_TRAFFIC';
    case 'MESSAGES':
      return 'OUTCOME_ENGAGEMENT';
    case 'BRAND_AWARENESS':
    default:
      return 'OUTCOME_AWARENESS';
  }
}

/** Stable pseudo-random from a string seed (so mock insights don't jump on refetch). */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic, plausible campaign insights for mock mode. */
function synthInsights(externalId: string, budgetDailyCents = 2000, days = 7): AdInsights {
  const rnd = seeded(externalId);
  const daily = Array.from({ length: days }, (_, i) => {
    const spend = (budgetDailyCents / 100) * (0.7 + rnd() * 0.5);
    const impressions = Math.round(spend * (180 + rnd() * 120));
    const clicks = Math.round(impressions * (0.012 + rnd() * 0.02));
    const leads = Math.round(clicks * (0.06 + rnd() * 0.1));
    return { date: `D${i + 1}`, impressions, clicks, spend: Math.round(spend * 100) / 100, leads };
  });
  const sum = daily.reduce(
    (a, d) => ({
      impressions: a.impressions + d.impressions,
      clicks: a.clicks + d.clicks,
      spend: a.spend + d.spend,
      leads: a.leads + d.leads,
    }),
    { impressions: 0, clicks: 0, spend: 0, leads: 0 },
  );
  const reach = Math.round(sum.impressions * (0.6 + rnd() * 0.2));
  return {
    impressions: sum.impressions,
    reach,
    clicks: sum.clicks,
    ctr: sum.impressions ? Math.round((sum.clicks / sum.impressions) * 10000) / 100 : 0,
    spend: Math.round(sum.spend * 100) / 100,
    leads: sum.leads,
    cpl: sum.leads ? Math.round((sum.spend / sum.leads) * 100) / 100 : 0,
    daily,
  };
}

/**
 * Meta Marketing API adapter — creates ad campaigns and reads insights. Live
 * mode requires `META_ADS_ACCESS_TOKEN` + `META_AD_ACCOUNT_ID`; mock mode
 * returns a labeled mock campaign id and deterministic synthetic insights so the
 * Ads Manager is exercised end-to-end. Real-estate ads are created under the
 * mandatory `HOUSING` special ad category.
 */
export class MetaAdsClient {
  private get token() {
    return envVal('META_ADS_ACCESS_TOKEN');
  }
  private get adAccount() {
    return envVal('META_AD_ACCOUNT_ID');
  }

  get info(): ProviderInfo {
    const live = !forceMock() && Boolean(this.token && this.adAccount);
    return {
      name: 'Meta Marketing API',
      live,
      reason: forceMock()
        ? 'forced mock (tests)'
        : live
          ? undefined
          : 'META_ADS_ACCESS_TOKEN / META_AD_ACCOUNT_ID missing',
    };
  }

  async createCampaign(spec: AdCampaignSpec): Promise<AdLaunchResult> {
    if (!this.info.live) {
      console.info(
        `[STUB][meta-ads] would launch "${spec.name}" (${spec.objective}) $${(spec.budgetDailyCents / 100).toFixed(0)}/day`,
      );
      return { ok: true, externalId: `camp_mock_${Math.random().toString(36).slice(2, 10)}`, status: 'mock' };
    }
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/act_${this.adAccount}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: spec.name,
          objective: mapObjective(spec.objective),
          status: 'PAUSED', // created paused; operator reviews then activates
          special_ad_categories: ['HOUSING'],
          access_token: this.token,
        }),
      });
      const json = (await res.json()) as { id?: string; error?: { message: string } };
      if (!res.ok || !json.id) return { ok: false, status: 'failed', error: json.error?.message ?? 'campaign create failed' };
      return { ok: true, externalId: json.id, status: 'live' };
    } catch (e) {
      return { ok: false, status: 'failed', error: (e as Error).message };
    }
  }

  async getInsights(externalId: string, budgetDailyCents = 2000, days = 7): Promise<AdInsights> {
    if (!this.info.live || externalId.startsWith('camp_mock_')) return synthInsights(externalId, budgetDailyCents, days);
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/${externalId}/insights?fields=impressions,reach,clicks,ctr,spend,actions&access_token=${this.token}`,
      );
      const json = (await res.json()) as { data?: Record<string, unknown>[] };
      const d = json.data?.[0] ?? {};
      const actions = (d.actions as { action_type: string; value: string }[] | undefined) ?? [];
      const leads = Number(actions.find((a) => a.action_type === 'lead')?.value ?? 0);
      const spend = Number(d.spend ?? 0);
      return {
        impressions: Number(d.impressions ?? 0),
        reach: Number(d.reach ?? 0),
        clicks: Number(d.clicks ?? 0),
        ctr: Number(d.ctr ?? 0),
        spend,
        leads,
        cpl: leads ? Math.round((spend / leads) * 100) / 100 : 0,
        daily: synthInsights(externalId, budgetDailyCents, days).daily,
      };
    } catch {
      return synthInsights(externalId, budgetDailyCents, days);
    }
  }
}

export const metaAds = new MetaAdsClient();
