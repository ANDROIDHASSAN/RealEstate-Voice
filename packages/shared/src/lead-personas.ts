/**
 * Lead Engine persona templates — the top real-estate prospect segments,
 * shipped as one-click presets. Each preset pre-fills source, query shape,
 * and filters; the user only picks a country/city.
 *
 * Consent note: scraped prospects NEVER get SMS/call consent — email-first
 * outreach only (ComplianceGuard enforces this downstream).
 */

export type ScrapeSource = 'google-maps' | 'zillow-fsbo' | 'expired' | 'instagram';

export interface ScrapeFilters {
  minRating?: number;
  hasPhone?: boolean;
  hasEmail?: boolean;
  propertyType?: 'residential' | 'condo' | 'luxury' | 'commercial' | 'land' | 'any';
  budgetBand?: 'entry' | 'mid' | 'high' | 'ultra' | 'any';
  language?: 'en' | 'es' | 'ar' | 'pt' | 'ht' | 'any';
  radiusKm?: number;
}

export interface LeadPersona {
  key: string;
  /** i18n-agnostic display name (UI may translate via `leadEngine.personas.<key>`) */
  name: string;
  emoji: string;
  intent: 'buyer' | 'seller' | 'investor' | 'renter' | 'unknown';
  source: ScrapeSource;
  /** `{city}` / `{country}` placeholders are merged at job creation. */
  queryTemplate: string;
  description: string;
  filters: ScrapeFilters;
  suggestedMaxResults: number;
}

export const LEAD_PERSONAS: LeadPersona[] = [
  {
    key: 'luxury-buyers',
    name: 'Luxury home buyers',
    emoji: '💎',
    intent: 'buyer',
    source: 'google-maps',
    queryTemplate: 'luxury home buyers {city}',
    description: 'High-net-worth individuals shopping the $1M+ bracket — country clubs, marinas, private schools radius.',
    filters: { propertyType: 'luxury', budgetBand: 'ultra', hasEmail: true, radiusKm: 25 },
    suggestedMaxResults: 25,
  },
  {
    key: 'cash-investors',
    name: 'Cash investors & flippers',
    emoji: '💵',
    intent: 'investor',
    source: 'google-maps',
    queryTemplate: 'real estate investors {city}',
    description: 'Investors who buy with cash and close fast — REI meetups, property management firms, hard-money circles.',
    filters: { propertyType: 'any', budgetBand: 'any', hasPhone: true, radiusKm: 50 },
    suggestedMaxResults: 50,
  },
  {
    key: 'first-time-buyers',
    name: 'First-time homebuyers',
    emoji: '🔑',
    intent: 'buyer',
    source: 'google-maps',
    queryTemplate: 'first time home buyer programs {city}',
    description: 'Renters ready to own — mortgage-preapproval seekers, FHA/first-buyer program audiences.',
    filters: { propertyType: 'residential', budgetBand: 'entry', hasEmail: true, radiusKm: 30 },
    suggestedMaxResults: 40,
  },
  {
    key: 'fsbo-sellers',
    name: 'FSBO sellers',
    emoji: '🏷️',
    intent: 'seller',
    source: 'zillow-fsbo',
    queryTemplate: 'for sale by owner {city}',
    description: 'Owners selling without an agent — the classic listing-appointment goldmine.',
    filters: { propertyType: 'residential', hasPhone: true, radiusKm: 40 },
    suggestedMaxResults: 30,
  },
  {
    key: 'expired-listings',
    name: 'Expired listings',
    emoji: '⏰',
    intent: 'seller',
    source: 'expired',
    queryTemplate: 'expired listings {city}',
    description: 'Listings that failed to sell — motivated sellers who already decided to sell once.',
    filters: { propertyType: 'any', hasPhone: true, radiusKm: 40 },
    suggestedMaxResults: 30,
  },
  {
    key: 'foreign-investors',
    name: 'Foreign & overseas investors',
    emoji: '🌍',
    intent: 'investor',
    source: 'google-maps',
    queryTemplate: 'international real estate investment {city} {country}',
    description: 'Overseas capital hunting US/GCC property — relocation services, EB-5/golden-visa consultants.',
    filters: { propertyType: 'luxury', budgetBand: 'high', hasEmail: true },
    suggestedMaxResults: 25,
  },
  {
    key: 'relocators',
    name: 'Corporate relocators',
    emoji: '✈️',
    intent: 'buyer',
    source: 'google-maps',
    queryTemplate: 'relocation services {city}',
    description: 'Families moving for work — HR relocation desks, moving companies, executive rentals.',
    filters: { propertyType: 'residential', budgetBand: 'mid', hasEmail: true, radiusKm: 30 },
    suggestedMaxResults: 35,
  },
  {
    key: 'downsizers',
    name: 'Downsizers & empty nesters',
    emoji: '🪺',
    intent: 'seller',
    source: 'google-maps',
    queryTemplate: 'retirement communities {city}',
    description: 'Owners of large family homes ready to trade down — a listing AND a purchase in one client.',
    filters: { propertyType: 'residential', budgetBand: 'mid', radiusKm: 30 },
    suggestedMaxResults: 30,
  },
  {
    key: 'absentee-owners',
    name: 'Absentee owners',
    emoji: '📬',
    intent: 'seller',
    source: 'google-maps',
    queryTemplate: 'property management {city}',
    description: 'Out-of-town owners with tenanted or vacant property — prime off-market listing inventory.',
    filters: { propertyType: 'any', hasEmail: true, radiusKm: 60 },
    suggestedMaxResults: 40,
  },
  {
    key: 'new-construction',
    name: 'New-construction buyers',
    emoji: '🏗️',
    intent: 'buyer',
    source: 'google-maps',
    queryTemplate: 'new construction homes {city}',
    description: 'Buyers touring model homes and pre-construction projects — long pipeline, high loyalty.',
    filters: { propertyType: 'residential', budgetBand: 'mid', radiusKm: 35 },
    suggestedMaxResults: 30,
  },
  {
    key: 'condo-investors',
    name: 'Condo & short-term-rental buyers',
    emoji: '🏝️',
    intent: 'investor',
    source: 'google-maps',
    queryTemplate: 'vacation rental management {city}',
    description: 'Airbnb/STR operators buying condos near tourist zones — repeat, portfolio-building clients.',
    filters: { propertyType: 'condo', budgetBand: 'mid', hasEmail: true, radiusKm: 25 },
    suggestedMaxResults: 35,
  },
  {
    key: 'pre-foreclosure',
    name: 'Pre-foreclosure owners',
    emoji: '🛟',
    intent: 'seller',
    source: 'expired',
    queryTemplate: 'pre foreclosure {city}',
    description: 'Owners in distress who need a fast, dignified exit — handle with care and full compliance.',
    filters: { propertyType: 'residential', hasPhone: true, radiusKm: 40 },
    suggestedMaxResults: 20,
  },
];

export function getLeadPersona(key: string): LeadPersona | undefined {
  return LEAD_PERSONAS.find((p) => p.key === key);
}

/** Merge `{city}` / `{country}` into a persona query template. */
export function buildPersonaQuery(template: string, city?: string, country?: string): string {
  return template
    .replace('{city}', city ?? '')
    .replace('{country}', country ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Countries surfaced in the Lead Engine location picker (extendable). */
export const SCRAPE_COUNTRIES: { code: string; name: string; cities: string[] }[] = [
  { code: 'US', name: 'United States', cities: ['Miami', 'Coral Gables', 'Orlando', 'Tampa', 'New York', 'Los Angeles', 'Houston', 'Dallas', 'Phoenix', 'Atlanta', 'Chicago', 'Las Vegas'] },
  { code: 'AE', name: 'United Arab Emirates', cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ras Al Khaimah'] },
  { code: 'SA', name: 'Saudi Arabia', cities: ['Riyadh', 'Jeddah', 'Dammam', 'NEOM'] },
  { code: 'QA', name: 'Qatar', cities: ['Doha', 'Lusail'] },
  { code: 'GB', name: 'United Kingdom', cities: ['London', 'Manchester', 'Birmingham'] },
  { code: 'CA', name: 'Canada', cities: ['Toronto', 'Vancouver', 'Montreal', 'Calgary'] },
  { code: 'MX', name: 'Mexico', cities: ['Mexico City', 'Cancún', 'Tulum', 'Guadalajara'] },
  { code: 'BR', name: 'Brazil', cities: ['São Paulo', 'Rio de Janeiro', 'Florianópolis'] },
  { code: 'PT', name: 'Portugal', cities: ['Lisbon', 'Porto', 'Algarve'] },
  { code: 'ES', name: 'Spain', cities: ['Madrid', 'Barcelona', 'Marbella', 'Valencia'] },
  { code: 'IN', name: 'India', cities: ['Mumbai', 'Delhi', 'Bengaluru', 'Pune', 'Hyderabad'] },
  { code: 'PK', name: 'Pakistan', cities: ['Karachi', 'Lahore', 'Islamabad'] },
];
