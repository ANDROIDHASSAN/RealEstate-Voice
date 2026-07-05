import { envVal, forceMock, type ProviderInfo } from './base.js';

export interface ScrapedLead {
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  location?: string;
  propertyInterest?: string;
  sourceDetail: string;
  /** Rich enrichment captured from the source (Google Places, etc.). */
  businessName?: string;
  rating?: number;
  reviewsCount?: number;
  website?: string;
  category?: string;
  address?: string;
  googleMapsUrl?: string;
}

/**
 * Apify client. Live mode runs a real actor; mock mode returns a realistic,
 * clearly-labeled sample dataset so the Lead Engine pipeline is exercised
 * end-to-end (dedupe → validate → enrich → campaign).
 */
export class ApifyClient {
  private get token() {
    return envVal('APIFY_TOKEN');
  }

  get info(): ProviderInfo {
    return {
      name: 'Apify',
      live: !forceMock() && Boolean(this.token),
      reason: forceMock() ? 'forced mock (tests)' : this.token ? undefined : 'APIFY_TOKEN missing',
    };
  }

  async runScrape(
    source: string,
    query: string,
    maxResults: number,
    filters?: { radiusKm?: number; minRating?: number; hasPhone?: boolean },
  ): Promise<ScrapedLead[]> {
    if (!this.info.live) return this.mockDataset(source, query, maxResults);
    // Actor per source; google-maps as the canonical example.
    const actorId = source === 'google-maps' ? 'compass~crawler-google-places' : 'apify~web-scraper';
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${this.token}&timeout=120`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          searchStringsArray: [query],
          maxCrawledPlacesPerSearch: maxResults,
          ...(filters?.radiusKm ? { searchRadiusKm: filters.radiusKm } : {}),
          ...(filters?.minRating ? { minStars: filters.minRating } : {}),
          ...(filters?.hasPhone ? { skipPlacesWithoutPhone: true } : {}),
        }),
      },
    );
    if (!res.ok) throw new Error(`Apify HTTP ${res.status}`);
    const items = (await res.json()) as Record<string, unknown>[];
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : undefined);
    const num = (v: unknown) => (typeof v === 'number' ? v : undefined);
    return items.slice(0, maxResults).map((it, i) => ({
      firstName: String(it.title ?? `Prospect ${i + 1}`).split(' ')[0] ?? 'Prospect',
      lastName: undefined,
      phone: str(it.phone) ?? str(it.phoneUnformatted),
      email: str(it.email),
      location: str(it.address) ?? query,
      propertyInterest: undefined,
      sourceDetail: `${source}:${query}`,
      // Google Places (compass~crawler-google-places) rich fields.
      businessName: str(it.title),
      rating: num(it.totalScore) ?? num(it.stars),
      reviewsCount: num(it.reviewsCount),
      website: str(it.website),
      category: str(it.categoryName) ?? (Array.isArray(it.categories) ? str(it.categories[0]) : undefined),
      address: str(it.address),
      googleMapsUrl: str(it.url),
    }));
  }

  /** [MOCK] deterministic sample prospects — labeled in UI as sample data. */
  private mockDataset(source: string, query: string, maxResults: number): ScrapedLead[] {
    const first = ['Carlos', 'Maria', 'James', 'Fatima', 'Lucas', 'Aisha', 'David', 'Sofia', 'Omar', 'Nadia'];
    const last = ['Rodriguez', 'Silva', 'Johnson', 'Al-Rashid', 'Costa', 'Hassan', 'Miller', 'Perez', 'Farsi', 'Jean'];
    const streets = ['Ocean Dr', 'Brickell Ave', 'Collins Ave', 'Biscayne Blvd', 'Coral Way'];
    const suffixes = ['Realty', 'Properties', 'Group', 'Homes', 'Estates'];
    const n = Math.min(maxResults, 10);
    return Array.from({ length: n }, (_, i) => {
      const fn = first[i % first.length]!;
      const ln = last[i % last.length]!;
      const slug = ln.toLowerCase().replace(/[^a-z]/g, '');
      return {
        firstName: fn,
        lastName: ln,
        phone: `+1305555${String(1000 + i * 7).slice(0, 4)}`,
        email: `${fn.toLowerCase()}.${slug}@example.com`,
        location: query,
        propertyInterest: source === 'zillow-fsbo' ? 'FSBO listing' : undefined,
        sourceDetail: `[MOCK] ${source}:${query}`,
        businessName: `${ln} ${suffixes[i % suffixes.length]}`,
        // Deterministic (index-seeded) so a demo scrape always looks the same.
        rating: Math.round((3.9 + (i % 11) * 0.1) * 10) / 10,
        reviewsCount: 12 + i * 17,
        website: `https://www.${slug}${suffixes[i % suffixes.length]!.toLowerCase()}.example.com`,
        category: source === 'zillow-fsbo' ? 'For sale by owner' : 'Real estate agency',
        address: `${100 + i * 13} ${streets[i % streets.length]}, ${query}`,
        googleMapsUrl: `https://maps.google.com/?q=${encodeURIComponent(`${ln} realty ${query}`)}`,
      };
    });
  }
}

export const apify = new ApifyClient();
