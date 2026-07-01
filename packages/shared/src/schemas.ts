import { z } from 'zod';
import { SUPPORTED_LOCALES } from './types.js';

export const localeSchema = z.enum(['en', 'es', 'ar', 'pt', 'ht']);

export const signupSchema = z.object({
  accountName: z.string().min(2).max(120),
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(128),
  phone: z.string().min(7).max(20).optional(),
  locale: localeSchema.default('en'),
  timezone: z.string().default('America/New_York'),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1),
});

/** Inbound lead webhook — accepts Zillow/FB/website/Zapier-ish shapes, normalized. */
export const leadWebhookSchema = z
  .object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().max(80).optional(),
    phone: z.string().min(7).max(20).optional(),
    email: z.string().email().optional(),
    source: z.enum(['zillow', 'facebook', 'website', 'zapier', 'instagram', 'other']).default('website'),
    locale: localeSchema.optional(),
    message: z.string().max(2000).optional(),
    propertyInterest: z.string().max(300).optional(),
    location: z.string().max(200).optional(),
    budget: z.string().max(60).optional(),
    consentSms: z.boolean().default(true),
    consentCall: z.boolean().default(true),
  })
  .refine((d) => d.phone || d.email, { message: 'phone or email required' });

export const createLeadSchema = leadWebhookSchema;

export const sequenceStepSchema = z.object({
  delayHours: z.number().min(0).max(24 * 365),
  channel: z.enum(['sms', 'whatsapp', 'email']),
  template: z.string().min(1).max(2000),
});

export const createSequenceSchema = z.object({
  name: z.string().min(2).max(120),
  locale: localeSchema.default('en'),
  steps: z.array(sequenceStepSchema).min(1).max(30),
});

export const triggerCallSchema = z.object({
  leadId: z.string().min(1),
  agentKey: z.string().min(1),
});

export const contentPostSchema = z.object({
  type: z.enum(['post', 'reel', 'story']).default('post'),
  caption: z.string().min(1).max(2200),
  mediaUrl: z.string().url().optional(),
  scheduledAt: z.string().datetime(),
});

export const generateCaptionSchema = z.object({
  topic: z.string().min(2).max(300),
  locale: localeSchema.default('en'),
  tone: z.enum(['professional', 'friendly', 'luxury', 'punchy']).default('friendly'),
  count: z.number().min(1).max(5).default(3),
});

export const scrapeJobSchema = z.object({
  source: z.enum(['google-maps', 'zillow-fsbo', 'expired', 'instagram']),
  query: z.string().min(2).max(300),
  maxResults: z.number().min(1).max(200).default(25),
});

export const orchestrateSchema = z.object({
  leadId: z.string().min(1),
  goal: z.string().min(2).max(500),
});

export const subscribeSchema = z.object({
  plan: z.enum(['starter', 'pro', 'empire']),
});

export { SUPPORTED_LOCALES };
