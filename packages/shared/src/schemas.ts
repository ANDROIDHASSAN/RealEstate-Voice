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

export const scrapeFiltersSchema = z.object({
  minRating: z.number().min(0).max(5).optional(),
  hasPhone: z.boolean().optional(),
  hasEmail: z.boolean().optional(),
  propertyType: z.enum(['residential', 'condo', 'luxury', 'commercial', 'land', 'any']).optional(),
  budgetBand: z.enum(['entry', 'mid', 'high', 'ultra', 'any']).optional(),
  language: z.enum(['en', 'es', 'ar', 'pt', 'ht', 'any']).optional(),
  radiusKm: z.number().min(1).max(500).optional(),
});

export const scrapeJobSchema = z.object({
  source: z.enum(['google-maps', 'zillow-fsbo', 'expired', 'instagram']),
  query: z.string().min(2).max(300),
  maxResults: z.number().min(1).max(200).default(25),
  country: z.string().max(60).optional(),
  city: z.string().max(80).optional(),
  personaKey: z.string().max(60).optional(),
  filters: scrapeFiltersSchema.optional(),
});

/** Assistant — one natural-language command (typed or voice-transcribed). */
export const assistantCommandSchema = z.object({
  text: z.string().min(1).max(1000),
  /** Where the user currently is, so the assistant can answer contextually. */
  page: z.string().max(60).optional(),
  locale: localeSchema.default('en'),
});

/** Actions the assistant is allowed to execute — a closed, auditable set. */
export const ASSISTANT_ACTIONS = [
  'navigate',
  'create_lead',
  'start_scrape',
  'trigger_call',
  'send_message',
  'message_leads',
  'call_leads',
  'orchestrate',
  'set_language',
  'answer',
  'clarify',
] as const;

export const assistantActionSchema = z.object({
  action: z.enum(ASSISTANT_ACTIONS),
  params: z.record(z.unknown()).default({}),
  reply: z.string().max(2000).default(''),
});

/**
 * A multi-step plan. The assistant may chain several actions from one command
 * ("find leads in Florida, message them, and call them") — each step is the
 * same closed, Zod-validated action set, executed in order by the server.
 */
export const assistantPlanSchema = z.object({
  steps: z.array(assistantActionSchema).min(1).max(6),
  reply: z.string().max(2000).default(''),
});

/** Per-provider API-key payload saved from Settings. Values are write-only. */
export const integrationKeysSchema = z.object({
  provider: z.enum(['twilio', 'whatsapp', 'resend', 'llm', 'stripe', 'apify', 'instagram', 'video', 'voice']),
  values: z.record(z.string().max(500)),
});

/** Knowledge base — add a document (RAG source) for the voice agent + assistant. */
export const knowledgeDocSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50_000),
  source: z.string().max(60).optional(),
});

export const knowledgeSearchSchema = z.object({
  query: z.string().min(1).max(500),
  k: z.number().min(1).max(10).optional(),
});

export const voicePromptSchema = z.object({
  systemPrompt: z.string().max(4000),
});

export const orchestrateSchema = z.object({
  leadId: z.string().min(1),
  goal: z.string().min(2).max(500),
});

export const subscribeSchema = z.object({
  plan: z.enum(['starter', 'pro', 'empire', 'ultimate']),
});

export { SUPPORTED_LOCALES };
