import { z } from 'zod';
import { localeSchema } from './schemas.js';

/**
 * Content Studio — the canonical constants, Zod schemas and inferred types for
 * the multi-platform publishing, media, connections, ads and competitor-research
 * surfaces. Imported by web + api. Providers behind these are mock-safe: they
 * light up when a key/OAuth token exists and run in labeled mock mode otherwise.
 */

// ── Platforms ────────────────────────────────────────────────────────────────
export const SOCIAL_PLATFORMS = ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; color: string; maxChars: number; video: boolean; image: boolean }
> = {
  instagram: { label: 'Instagram', color: '#E6DDF8', maxChars: 2200, video: true, image: true },
  facebook: { label: 'Facebook', color: '#D9E7F7', maxChars: 63206, video: true, image: true },
  youtube: { label: 'YouTube', color: '#F9DCDC', maxChars: 5000, video: true, image: false },
  tiktok: { label: 'TikTok', color: '#F4EEE7', maxChars: 2200, video: true, image: false },
  linkedin: { label: 'LinkedIn', color: '#D2ECDB', maxChars: 3000, video: true, image: true },
};

// ── Formats / aspect ratios ──────────────────────────────────────────────────
export const ASPECT_RATIOS = ['1:1', '4:5', '9:16', '16:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const POST_FORMATS = ['feed-square', 'feed-portrait', 'reel', 'story', 'landscape', 'short'] as const;
export type PostFormat = (typeof POST_FORMATS)[number];

export const FORMAT_SPECS: Record<
  PostFormat,
  { label: string; aspect: AspectRatio; width: number; height: number; kind: 'image' | 'video' | 'either' }
> = {
  'feed-square': { label: 'Square post', aspect: '1:1', width: 1080, height: 1080, kind: 'either' },
  'feed-portrait': { label: 'Portrait post', aspect: '4:5', width: 1080, height: 1350, kind: 'either' },
  reel: { label: 'Reel', aspect: '9:16', width: 1080, height: 1920, kind: 'video' },
  story: { label: 'Story', aspect: '9:16', width: 1080, height: 1920, kind: 'either' },
  landscape: { label: 'Landscape video (16:9)', aspect: '16:9', width: 1920, height: 1080, kind: 'video' },
  short: { label: 'Short / TikTok (9:16)', aspect: '9:16', width: 1080, height: 1920, kind: 'video' },
};

// ── Caption / creative generation ────────────────────────────────────────────
export const CONTENT_TONES = ['professional', 'friendly', 'luxury', 'punchy', 'bold', 'educational', 'story'] as const;
export type ContentTone = (typeof CONTENT_TONES)[number];

export const CONTENT_GOALS = ['engagement', 'leads', 'listing', 'branding', 'education'] as const;
export type ContentGoal = (typeof CONTENT_GOALS)[number];

/** Richer, structured generation for the Composer (hook + body + CTA + hashtags). */
export const composerGenerateSchema = z.object({
  topic: z.string().min(2).max(500),
  platform: z.enum(SOCIAL_PLATFORMS).default('instagram'),
  format: z.enum(POST_FORMATS).default('feed-square'),
  tone: z.enum(CONTENT_TONES).default('friendly'),
  goal: z.enum(CONTENT_GOALS).default('engagement'),
  locale: localeSchema.default('en'),
  includeHashtags: z.boolean().default(true),
  includeHook: z.boolean().default(true),
  includeCta: z.boolean().default(true),
  listingDetails: z.string().max(1200).optional(),
  variants: z.number().int().min(1).max(4).default(3),
});
export type ComposerGenerateInput = z.infer<typeof composerGenerateSchema>;

export interface GeneratedPost {
  hook: string;
  caption: string;
  hashtags: string[];
  firstComment: string;
  cta: string;
}

// ── Multi-platform publish ───────────────────────────────────────────────────
export const composerPostSchema = z
  .object({
    platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1).max(5),
    format: z.enum(POST_FORMATS).default('feed-square'),
    title: z.string().max(140).optional(),
    caption: z.string().min(1).max(5000),
    firstComment: z.string().max(2200).optional(),
    mediaAssetIds: z.array(z.string()).max(10).default([]),
    mediaUrls: z.array(z.string().url()).max(10).default([]),
    scheduledAt: z.string().datetime().optional(),
    publishNow: z.boolean().default(false),
  })
  .refine((d) => d.publishNow || d.scheduledAt, { message: 'scheduledAt required unless publishNow' });
export type ComposerPostInput = z.infer<typeof composerPostSchema>;

// ── Media library ────────────────────────────────────────────────────────────
export const MEDIA_SOURCES = ['upload', 'ai-generated', 'stock', 'url'] as const;

export const mediaAssetCreateSchema = z
  .object({
    name: z.string().min(1).max(200),
    kind: z.enum(['image', 'video']),
    url: z.string().url().optional(),
    /** base64 data URL body (no prefix) — persisted by the storage adapter. */
    dataBase64: z.string().max(20_000_000).optional(),
    contentType: z.string().max(100).optional(),
    aspect: z.enum(ASPECT_RATIOS).optional(),
    width: z.number().int().positive().max(16000).optional(),
    height: z.number().int().positive().max(16000).optional(),
    durationSec: z.number().positive().max(7200).optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    tags: z.array(z.string().max(40)).max(20).default([]),
    source: z.enum(MEDIA_SOURCES).default('upload'),
  })
  .refine((d) => d.url || d.dataBase64, { message: 'url or dataBase64 required' });
export type MediaAssetCreateInput = z.infer<typeof mediaAssetCreateSchema>;

/** AI image generation for a listing/post (mock returns a labeled placeholder). */
export const generateImageSchema = z.object({
  prompt: z.string().min(2).max(1000),
  aspect: z.enum(ASPECT_RATIOS).default('1:1'),
  style: z.enum(['photoreal', 'lifestyle', 'editorial', 'minimal', 'luxury']).default('photoreal'),
});
export type GenerateImageInput = z.infer<typeof generateImageSchema>;

// ── Social connections ───────────────────────────────────────────────────────
export const CONNECTION_STATUSES = ['connected', 'pending', 'disconnected', 'error'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const connectPlatformSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  accessToken: z.string().max(4000).optional(),
  externalId: z.string().max(200).optional(),
  displayName: z.string().max(200).optional(),
});
export type ConnectPlatformInput = z.infer<typeof connectPlatformSchema>;

// ── Ads ──────────────────────────────────────────────────────────────────────
export const AD_OBJECTIVES = [
  'LEADS',
  'TRAFFIC',
  'LISTING_PROMOTION',
  'SELLER_LEADS',
  'OPEN_HOUSE',
  'BRAND_AWARENESS',
  'MESSAGES',
] as const;
export type AdObjective = (typeof AD_OBJECTIVES)[number];

export const AD_CTAS = [
  'LEARN_MORE',
  'CONTACT_US',
  'BOOK_NOW',
  'SIGN_UP',
  'GET_QUOTE',
  'SEE_LISTING',
  'CALL_NOW',
  'SEND_MESSAGE',
] as const;
export type AdCta = (typeof AD_CTAS)[number];

/** AI-classified creative angles used across ads + competitor research. */
export const AD_ANGLES = [
  'just-listed',
  'price-drop',
  'open-house',
  'luxury',
  'first-time-buyer',
  'seller-lead',
  'social-proof',
  'urgency',
  'neighborhood',
  'fsbo',
] as const;
export type AdAngle = (typeof AD_ANGLES)[number];

export const adTargetingSchema = z.object({
  geo: z
    .object({
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      radiusKm: z.number().min(1).max(80).default(16),
      cities: z.array(z.string().max(80)).max(20).default([]),
      country: z.string().max(60).default('US'),
    })
    .default({}),
  ageMin: z.number().int().min(18).max(65).default(25),
  ageMax: z.number().int().min(18).max(65).default(65),
  genders: z.array(z.enum(['all', 'male', 'female'])).default(['all']),
  interests: z.array(z.string().max(60)).max(30).default([]),
});
export type AdTargeting = z.infer<typeof adTargetingSchema>;

export const adCampaignSchema = z.object({
  name: z.string().min(2).max(140),
  objective: z.enum(AD_OBJECTIVES).default('LEADS'),
  platform: z.enum(['meta', 'google', 'youtube', 'tiktok']).default('meta'),
  budgetDaily: z.number().min(1).max(100_000).default(20),
  durationDays: z.number().int().min(1).max(365).default(7),
  startAt: z.string().datetime().optional(),
  creative: z.object({
    headline: z.string().min(1).max(140),
    primaryText: z.string().min(1).max(2000),
    cta: z.enum(AD_CTAS).default('LEARN_MORE'),
    imageUrl: z.string().url().optional(),
    linkUrl: z.string().url().optional(),
  }),
  fromPostId: z.string().max(60).optional(),
  targeting: adTargetingSchema.default({}),
});
export type AdCampaignInput = z.infer<typeof adCampaignSchema>;

// ── Competitor research (Meta Ad Library) ────────────────────────────────────
export const adResearchSchema = z.object({
  query: z.string().min(2).max(200),
  region: z.string().max(60).default('US'),
  platform: z.enum(['facebook', 'instagram', 'all']).default('all'),
  count: z.number().int().min(1).max(50).default(20),
  activeStatus: z.enum(['active', 'all']).default('active'),
});
export type AdResearchInput = z.infer<typeof adResearchSchema>;

export interface CompetitorAdRaw {
  advertiser: string;
  page: string;
  platform: string;
  headline: string;
  primaryText: string;
  cta: string;
  mediaType: 'image' | 'video' | 'carousel';
  thumbnailUrl: string;
  startedRunning: string;
  daysRunning: number;
  estimatedSpend: string;
  impressionsRange: string;
  angle: AdAngle;
  sourceUrl: string;
}

// ── Best-time-to-post heuristics (per platform, agent local tz) ───────────────
export const BEST_TIMES: Record<SocialPlatform, { day: string; hour: number; label: string }[]> = {
  instagram: [
    { day: 'Wed', hour: 11, label: 'Wed 11:00' },
    { day: 'Fri', hour: 13, label: 'Fri 13:00' },
    { day: 'Sun', hour: 19, label: 'Sun 19:00' },
  ],
  facebook: [
    { day: 'Tue', hour: 9, label: 'Tue 09:00' },
    { day: 'Thu', hour: 15, label: 'Thu 15:00' },
    { day: 'Sat', hour: 12, label: 'Sat 12:00' },
  ],
  youtube: [
    { day: 'Fri', hour: 17, label: 'Fri 17:00' },
    { day: 'Sat', hour: 10, label: 'Sat 10:00' },
    { day: 'Sun', hour: 16, label: 'Sun 16:00' },
  ],
  tiktok: [
    { day: 'Tue', hour: 18, label: 'Tue 18:00' },
    { day: 'Thu', hour: 21, label: 'Thu 21:00' },
    { day: 'Sat', hour: 20, label: 'Sat 20:00' },
  ],
  linkedin: [
    { day: 'Tue', hour: 8, label: 'Tue 08:00' },
    { day: 'Wed', hour: 12, label: 'Wed 12:00' },
    { day: 'Thu', hour: 17, label: 'Thu 17:00' },
  ],
};
