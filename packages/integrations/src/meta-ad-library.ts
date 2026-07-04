import { envVal, forceMock, type ProviderInfo } from './base.js';

export interface AdLibraryQuery {
  query: string;
  region: string;
  platform: 'facebook' | 'instagram' | 'all';
  count: number;
  activeStatus: 'active' | 'all';
}

export interface CompetitorAdItem {
  advertiser: string;
  page: string;
  platform: string;
  headline: string;
  primaryText: string;
  cta: string;
  mediaType: 'image' | 'video' | 'carousel';
  thumbnailUrl: string;
  startedRunning: string; // ISO date
  daysRunning: number;
  estimatedSpend: string;
  impressionsRange: string;
  angle: string;
  sourceUrl: string;
}

const ADVERTISERS = [
  'Compass Realty',
  'Coldwell Banker',
  'Keller Williams Elite',
  'The Corcoran Group',
  'Douglas Elliman',
  'RE/MAX Signature',
  'Sotheby’s International',
  'eXp Luxury',
  'Berkshire Hathaway HS',
  'Century 21 Prime',
];

const ANGLE_TEMPLATES: { angle: string; headline: string; body: string; cta: string; media: 'image' | 'video' | 'carousel' }[] = [
  { angle: 'just-listed', headline: 'Just Listed in {q} 🏡', body: 'New to market — 3BR/2BA with a chef’s kitchen. Book a private tour before it’s gone.', cta: 'SEE_LISTING', media: 'carousel' },
  { angle: 'open-house', headline: 'Open House this Saturday', body: 'Walk through the {q} home everyone’s talking about. 12–3pm, refreshments on us.', cta: 'BOOK_NOW', media: 'image' },
  { angle: 'seller-lead', headline: 'What’s your {q} home worth?', body: 'Get a free, no-obligation valuation in 60 seconds. Homes here are selling in 9 days.', cta: 'GET_QUOTE', media: 'video' },
  { angle: 'price-drop', headline: 'Price Improved — {q}', body: '$25,000 reduction on a move-in-ready stunner. Motivated seller, act fast.', cta: 'LEARN_MORE', media: 'image' },
  { angle: 'luxury', headline: 'Live Above It All in {q}', body: 'Panoramic waterfront penthouse. Private elevator, rooftop pool. By appointment only.', cta: 'CONTACT_US', media: 'video' },
  { angle: 'first-time-buyer', headline: 'Buy Before You Rent Again', body: 'First-time buyer programs in {q} — as little as 3% down. Let’s run your numbers.', cta: 'SIGN_UP', media: 'image' },
  { angle: 'social-proof', headline: '#1 Team in {q} 3 Years Running', body: '478 families moved last year. Read why sellers choose us — then let’s talk.', cta: 'CONTACT_US', media: 'carousel' },
  { angle: 'neighborhood', headline: 'The {q} Market Report', body: 'Median up 6.2% YoY. Download the free neighborhood guide before you list.', cta: 'LEARN_MORE', media: 'image' },
];

const SPEND_BANDS = ['<$100', '$100–$500', '$500–$1K', '$1K–$5K', '$5K–$10K'];
const IMPR_BANDS = ['1K–5K', '5K–10K', '10K–50K', '50K–100K', '100K–500K'];

/**
 * Meta Ad Library research adapter — competitor ad intelligence. Live mode
 * queries the public `ads_archive` Graph endpoint (`META_ADS_ACCESS_TOKEN`);
 * mock mode returns a deterministic, realistic set of competitor real-estate
 * ads (clearly flagged `stub:true`) so the Market Research surface is fully
 * exercised: angles, spend bands, days-running, and creative copy.
 */
export class MetaAdLibraryClient {
  private get token() {
    return envVal('META_ADS_ACCESS_TOKEN');
  }

  get info(): ProviderInfo {
    return {
      name: 'Meta Ad Library API',
      live: !forceMock() && Boolean(this.token),
      reason: forceMock()
        ? 'forced mock (tests)'
        : this.token
          ? undefined
          : 'META_ADS_ACCESS_TOKEN missing (Ad Library access)',
    };
  }

  async search(q: AdLibraryQuery): Promise<{ items: CompetitorAdItem[]; stub: boolean }> {
    if (!this.info.live) return { items: this.mockAds(q), stub: true };
    try {
      const platforms = q.platform === 'all' ? '' : `&publisher_platforms=['${q.platform}']`;
      const url =
        `https://graph.facebook.com/v20.0/ads_archive?search_terms=${encodeURIComponent(q.query)}` +
        `&ad_reached_countries=['${q.region}']&ad_active_status=${q.activeStatus === 'active' ? 'ACTIVE' : 'ALL'}` +
        `&fields=page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_delivery_start_time,publisher_platforms,ad_snapshot_url,impressions,spend` +
        `${platforms}&limit=${q.count}&access_token=${this.token}`;
      const res = await fetch(url);
      const json = (await res.json()) as { data?: Record<string, unknown>[]; error?: { message: string } };
      if (!res.ok || !json.data || json.data.length === 0) return { items: this.mockAds(q), stub: true };
      return { items: json.data.map((d) => this.mapArchive(d, q)), stub: false };
    } catch {
      return { items: this.mockAds(q), stub: true };
    }
  }

  private mapArchive(d: Record<string, unknown>, q: AdLibraryQuery): CompetitorAdItem {
    const start = String((d.ad_delivery_start_time as string) ?? new Date().toISOString());
    const days = Math.max(1, Math.round((Date.now() - new Date(start).getTime()) / 86400000));
    const bodies = (d.ad_creative_bodies as string[] | undefined) ?? [];
    const titles = (d.ad_creative_link_titles as string[] | undefined) ?? [];
    return {
      advertiser: String((d.page_name as string) ?? 'Unknown'),
      page: String((d.page_name as string) ?? 'Unknown'),
      platform: ((d.publisher_platforms as string[] | undefined) ?? [q.platform]).join(', '),
      headline: titles[0] ?? 'Real estate ad',
      primaryText: bodies[0] ?? '',
      cta: 'LEARN_MORE',
      mediaType: 'image',
      thumbnailUrl: 'https://placehold.co/600x600/E6DDF8/1A1A1A?text=Ad',
      startedRunning: start,
      daysRunning: days,
      estimatedSpend: typeof d.spend === 'object' ? JSON.stringify(d.spend) : String(d.spend ?? 'n/a'),
      impressionsRange: typeof d.impressions === 'object' ? JSON.stringify(d.impressions) : String(d.impressions ?? 'n/a'),
      angle: 'social-proof',
      sourceUrl: String((d.ad_snapshot_url as string) ?? 'https://www.facebook.com/ads/library/'),
    };
  }

  /** Deterministic, labeled competitor dataset for mock mode. */
  private mockAds(q: AdLibraryQuery): CompetitorAdItem[] {
    const n = Math.min(q.count, 24);
    return Array.from({ length: n }, (_, i) => {
      const tpl = ANGLE_TEMPLATES[i % ANGLE_TEMPLATES.length]!;
      const advertiser = ADVERTISERS[i % ADVERTISERS.length]!;
      const days = 3 + ((i * 7) % 60);
      const start = new Date(Date.now() - days * 86400000).toISOString();
      return {
        advertiser: `[SAMPLE] ${advertiser}`,
        page: advertiser,
        platform: q.platform === 'all' ? (i % 2 ? 'instagram' : 'facebook') : q.platform,
        headline: tpl.headline.replace('{q}', q.query),
        primaryText: tpl.body.replace('{q}', q.query),
        cta: tpl.cta,
        mediaType: tpl.media,
        thumbnailUrl: `https://placehold.co/600x600/${['E6DDF8', 'D9E7F7', 'D2ECDB', 'FCEBCB', 'F9DCDC'][i % 5]}/1A1A1A?text=${encodeURIComponent(tpl.angle)}`,
        startedRunning: start,
        daysRunning: days,
        estimatedSpend: SPEND_BANDS[Math.min(SPEND_BANDS.length - 1, Math.floor(days / 12))]!,
        impressionsRange: IMPR_BANDS[Math.min(IMPR_BANDS.length - 1, Math.floor(days / 12))]!,
        angle: tpl.angle,
        sourceUrl: 'https://www.facebook.com/ads/library/',
      };
    });
  }
}

export const metaAdLibrary = new MetaAdLibraryClient();
