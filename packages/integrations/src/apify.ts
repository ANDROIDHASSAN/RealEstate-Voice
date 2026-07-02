import { envVal, forceMock, type ProviderInfo } from './base.js';

export interface ScrapedLead {
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  location?: string;
  propertyInterest?: string;
  sourceDetail: string;
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
    return items.slice(0, maxResults).map((it, i) => ({
      firstName: String(it.title ?? `Prospect ${i + 1}`).split(' ')[0] ?? 'Prospect',
      lastName: undefined,
      phone: typeof it.phone === 'string' ? it.phone : undefined,
      email: undefined,
      location: typeof it.address === 'string' ? it.address : query,
      propertyInterest: undefined,
      sourceDetail: `${source}:${query}`,
    }));
  }

  /** [MOCK] deterministic sample prospects — labeled in UI as sample data. */
  private mockDataset(source: string, query: string, maxResults: number): ScrapedLead[] {
    const first = ['Carlos', 'Maria', 'James', 'Fatima', 'Lucas', 'Aisha', 'David', 'Sofia', 'Omar', 'Nadia'];
    const last = ['Rodriguez', 'Silva', 'Johnson', 'Al-Rashid', 'Costa', 'Hassan', 'Miller', 'Perez', 'Farsi', 'Jean'];
    const n = Math.min(maxResults, 10);
    return Array.from({ length: n }, (_, i) => ({
      firstName: first[i % first.length]!,
      lastName: last[i % last.length]!,
      phone: `+1305555${String(1000 + i * 7).slice(0, 4)}`,
      email: `${first[i % first.length]!.toLowerCase()}.${last[i % last.length]!.toLowerCase().replace(/[^a-z]/g, '')}@example.com`,
      location: query,
      propertyInterest: source === 'zillow-fsbo' ? 'FSBO listing' : undefined,
      sourceDetail: `[MOCK] ${source}:${query}`,
    }));
  }
}

export const apify = new ApifyClient();
