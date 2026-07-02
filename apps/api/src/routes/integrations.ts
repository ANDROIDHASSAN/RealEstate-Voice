import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { apify, getLLM, instagram, resend, stripe, twilio, video, whatsapp } from '@closeflow/integrations';
import { getVoiceProvider, resetVoiceProvider } from '@closeflow/voice';
import { logger } from '../logger.js';
import { requireAuth } from '../middleware/auth.js';
import { IntegrationSetting } from '../models.js';

/**
 * In-app API key configuration. Keys are stored per account (masked on read)
 * and applied to process.env so the integration clients — which read env at
 * call time — switch from mock to live without a restart.
 *
 * Single-instance semantics: env is process-wide, so on a shared deployment
 * the most recent save wins. Documented in DECISIONS.md; fine for the
 * current self-hosted / single-operator model.
 */

interface ProviderField {
  var: string;
  label: string;
  secret: boolean;
}
/** A dropdown selection (provider / model choice) — stored as an env var. */
interface ProviderOption {
  var: string;
  label: string;
  choices: { value: string; label: string }[];
  default: string;
}
interface ProviderDef {
  key: string;
  name: string;
  docsUrl: string;
  fields: ProviderField[];
  options?: ProviderOption[];
}

export const PROVIDER_CATALOG: ProviderDef[] = [
  {
    key: 'twilio',
    name: 'Twilio (SMS & phone)',
    docsUrl: 'https://console.twilio.com',
    fields: [
      { var: 'TWILIO_ACCOUNT_SID', label: 'Account SID', secret: false },
      { var: 'TWILIO_AUTH_TOKEN', label: 'Auth token', secret: true },
      { var: 'TWILIO_PHONE_NUMBER', label: 'Phone number', secret: false },
    ],
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp Cloud API',
    docsUrl: 'https://developers.facebook.com/docs/whatsapp',
    fields: [
      { var: 'WHATSAPP_TOKEN', label: 'Access token', secret: true },
      { var: 'WHATSAPP_PHONE_ID', label: 'Phone number ID', secret: false },
    ],
  },
  {
    key: 'resend',
    name: 'Resend (email)',
    docsUrl: 'https://resend.com/api-keys',
    fields: [{ var: 'RESEND_API_KEY', label: 'API key', secret: true }],
  },
  {
    key: 'llm',
    name: 'AI brain (Gemini / Groq / OpenAI)',
    docsUrl: 'https://aistudio.google.com/apikey',
    fields: [
      { var: 'GEMINI_API_KEY', label: 'Gemini API key', secret: true },
      { var: 'GROQ_API_KEY', label: 'Groq API key', secret: true },
      { var: 'OPENAI_API_KEY', label: 'OpenAI API key', secret: true },
    ],
    options: [
      {
        var: 'LLM_PROVIDER',
        label: 'Preferred provider',
        default: 'auto',
        choices: [
          { value: 'auto', label: 'Auto (first available)' },
          { value: 'gemini', label: 'Google Gemini' },
          { value: 'groq', label: 'Groq' },
          { value: 'openai', label: 'OpenAI' },
        ],
      },
      {
        var: 'GEMINI_MODEL',
        label: 'Gemini model',
        default: 'gemini-2.0-flash',
        choices: [
          { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
          { value: 'gemini-2.0-flash-lite', label: 'gemini-2.0-flash-lite' },
          { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
          { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
        ],
      },
      {
        var: 'GROQ_MODEL',
        label: 'Groq model',
        default: 'llama-3.3-70b-versatile',
        choices: [
          { value: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
          { value: 'llama-3.1-8b-instant', label: 'llama-3.1-8b-instant' },
          { value: 'openai/gpt-oss-120b', label: 'gpt-oss-120b' },
          { value: 'moonshotai/kimi-k2-instruct', label: 'kimi-k2-instruct' },
        ],
      },
      {
        var: 'OPENAI_MODEL',
        label: 'OpenAI model',
        default: 'gpt-4o-mini',
        choices: [
          { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
          { value: 'gpt-4o', label: 'gpt-4o' },
          { value: 'gpt-4.1', label: 'gpt-4.1' },
          { value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
          { value: 'o4-mini', label: 'o4-mini' },
        ],
      },
    ],
  },
  {
    key: 'stripe',
    name: 'Stripe (billing)',
    docsUrl: 'https://dashboard.stripe.com/apikeys',
    fields: [{ var: 'STRIPE_SECRET_KEY', label: 'Secret key', secret: true }],
  },
  {
    key: 'apify',
    name: 'Apify (lead scraping)',
    docsUrl: 'https://console.apify.com/account/integrations',
    fields: [{ var: 'APIFY_TOKEN', label: 'API token', secret: true }],
  },
  {
    key: 'instagram',
    name: 'Instagram Graph API',
    docsUrl: 'https://developers.facebook.com/docs/instagram-api',
    fields: [{ var: 'IG_ACCESS_TOKEN', label: 'Access token', secret: true }],
  },
  {
    key: 'video',
    name: 'Video render (Creatomate / Higgsfield)',
    docsUrl: 'https://creatomate.com',
    fields: [
      { var: 'CREATOMATE_API_KEY', label: 'Creatomate key', secret: true },
      { var: 'HIGGSFIELD_API_KEY', label: 'Higgsfield key', secret: true },
    ],
    options: [
      {
        var: 'VIDEO_PROVIDER',
        label: 'Render engine',
        default: 'creatomate',
        choices: [
          { value: 'creatomate', label: 'Creatomate' },
          { value: 'higgsfield', label: 'Higgsfield' },
        ],
      },
    ],
  },
  {
    key: 'voice',
    name: 'Voice provider (Vapi / Dograh)',
    docsUrl: 'https://dashboard.vapi.ai',
    fields: [
      { var: 'VAPI_API_KEY', label: 'Vapi API key', secret: true },
      { var: 'DOGRAH_BASE_URL', label: 'Dograh self-hosted URL', secret: false },
      { var: 'DOGRAH_API_KEY', label: 'Dograh API key', secret: true },
      { var: 'VOICE_TTS_VOICE', label: 'Voice ID (TTS voice)', secret: false },
    ],
    options: [
      {
        var: 'VOICE_PROVIDER',
        label: 'Call provider',
        default: 'mock',
        choices: [
          { value: 'mock', label: 'Mock (simulated calls)' },
          { value: 'vapi', label: 'Vapi' },
          { value: 'dograh', label: 'Dograh (self-hosted)' },
          { value: 'gemini-live', label: 'Gemini Live' },
        ],
      },
      {
        var: 'VOICE_TTS_PROVIDER',
        label: 'Text-to-speech (voice)',
        default: '11labs',
        choices: [
          { value: '11labs', label: 'ElevenLabs' },
          { value: 'openai', label: 'OpenAI TTS' },
          { value: 'cartesia', label: 'Cartesia' },
          { value: 'playht', label: 'PlayHT' },
          { value: 'azure', label: 'Azure' },
        ],
      },
      {
        var: 'VOICE_STT_PROVIDER',
        label: 'Speech-to-text (transcriber)',
        default: 'deepgram',
        choices: [
          { value: 'deepgram', label: 'Deepgram' },
          { value: 'openai', label: 'OpenAI Whisper' },
          { value: 'assembly', label: 'AssemblyAI' },
          { value: 'gladia', label: 'Gladia' },
        ],
      },
      {
        var: 'VOICE_LLM_PROVIDER',
        label: 'In-call brain (provider)',
        default: 'groq',
        choices: [
          { value: 'groq', label: 'Groq' },
          { value: 'openai', label: 'OpenAI' },
          { value: 'anthropic', label: 'Anthropic' },
          { value: 'google', label: 'Google' },
        ],
      },
      {
        var: 'VOICE_LLM_MODEL',
        label: 'In-call brain (model)',
        default: 'llama-3.3-70b-versatile',
        choices: [
          { value: 'llama-3.3-70b-versatile', label: 'llama-3.3-70b-versatile' },
          { value: 'gpt-4o', label: 'gpt-4o' },
          { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
          { value: 'claude-3-5-sonnet', label: 'claude-3-5-sonnet' },
        ],
      },
    ],
  },
];

const ALLOWED_VARS = new Set(
  PROVIDER_CATALOG.flatMap((p) => [...p.fields.map((f) => f.var), ...(p.options ?? []).map((o) => o.var)]),
);
/** Option vars are constrained to their declared choices (defence-in-depth). */
const OPTION_CHOICES = new Map(
  PROVIDER_CATALOG.flatMap((p) => (p.options ?? []).map((o) => [o.var, new Set(o.choices.map((c) => c.value))] as const)),
);

function providerInfo(key: string) {
  switch (key) {
    case 'twilio': return twilio.info;
    case 'whatsapp': return whatsapp.info;
    case 'resend': return resend.info;
    case 'llm': return getLLM().info;
    case 'stripe': return stripe.info;
    case 'apify': return apify.info;
    case 'instagram': return instagram.info;
    case 'video': return video.info;
    case 'voice': {
      const v = getVoiceProvider();
      return { name: `Voice (${v.name})`, live: v.live, reason: v.reason };
    }
    default: return { name: key, live: false, reason: 'unknown provider' };
  }
}

function mask(value: string): string {
  if (value.length <= 6) return '••••';
  return `${value.slice(0, 3)}…${value.slice(-3)}`;
}

export const integrationsRouter = Router();
integrationsRouter.use(requireAuth);

/** Catalog + saved (masked) values + live status per provider. */
integrationsRouter.get('/', async (req: Request, res: Response) => {
  const saved = await IntegrationSetting.find({ accountId: req.auth!.accountId }).lean();
  const byProvider = new Map(saved.map((s) => [s.provider, s]));
  res.json({
    providers: PROVIDER_CATALOG.map((p) => {
      const doc = byProvider.get(p.key);
      const values = (doc?.values ?? {}) as Record<string, string>;
      return {
        ...p,
        status: providerInfo(p.key),
        fields: p.fields.map((f) => {
          const stored = values[f.var] ?? '';
          const envSet = Boolean(process.env[f.var]?.trim());
          return {
            ...f,
            configured: Boolean(stored) || envSet,
            maskedValue: stored ? mask(stored) : envSet ? '(from .env)' : '',
          };
        }),
        options: (p.options ?? []).map((o) => ({
          ...o,
          // Current selection: saved → env → default (never a secret, safe to return).
          value: values[o.var] || process.env[o.var]?.replace(/\s+#.*$/, '').trim() || o.default,
        })),
      };
    }),
  });
});

const saveSchema = z.object({ values: z.record(z.string().max(500)) });

/** Save keys for one provider — owner only; applied to env immediately. */
integrationsRouter.put('/:provider', async (req: Request, res: Response) => {
  if (req.auth!.role !== 'owner' && req.auth!.role !== 'admin') {
    return res.status(403).json({ error: 'owner_only' });
  }
  const def = PROVIDER_CATALOG.find((p) => p.key === req.params.provider);
  if (!def) return res.status(404).json({ error: 'unknown_provider' });
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });

  const belongsToProvider = (k: string) =>
    def.fields.some((f) => f.var === k) || (def.options ?? []).some((o) => o.var === k);
  const withinChoices = (k: string, v: string) => {
    const choices = OPTION_CHOICES.get(k);
    return !choices || choices.has(v);
  };
  const entries = Object.entries(parsed.data.values).filter(
    ([k, v]) => ALLOWED_VARS.has(k) && belongsToProvider(k) && v.trim().length > 0 && withinChoices(k, v.trim()),
  );
  if (!entries.length) return res.status(400).json({ error: 'no_valid_keys' });

  const doc = await IntegrationSetting.findOneAndUpdate(
    { accountId: req.auth!.accountId, provider: def.key },
    { $set: Object.fromEntries(entries.map(([k, v]) => [`values.${k}`, v.trim()])) },
    { new: true, upsert: true },
  );
  for (const [k, v] of entries) process.env[k] = v.trim();
  // Voice provider is cached as a singleton — rebuild it so the new selection
  // (provider / TTS / STT) takes effect without a restart.
  if (def.key === 'voice') resetVoiceProvider();
  logger.info({ provider: def.key, vars: entries.map(([k]) => k) }, 'integration keys saved from UI');
  return res.json({ ok: true, status: providerInfo(def.key), saved: entries.map(([k]) => k), updatedAt: doc.updatedAt });
});

/** Remove a saved key (falls back to .env value if one exists). */
integrationsRouter.delete('/:provider/:varName', async (req: Request, res: Response) => {
  if (req.auth!.role !== 'owner' && req.auth!.role !== 'admin') {
    return res.status(403).json({ error: 'owner_only' });
  }
  const provider = String(req.params.provider ?? '');
  const varName = String(req.params.varName ?? '');
  if (!ALLOWED_VARS.has(varName)) return res.status(404).json({ error: 'unknown_key' });
  await IntegrationSetting.updateOne(
    { accountId: req.auth!.accountId, provider },
    { $unset: { [`values.${varName}`]: 1 } },
  );
  delete process.env[varName];
  return res.json({ ok: true, status: providerInfo(provider) });
});

/** Boot hook — re-apply persisted UI-configured keys to process.env. */
export async function applyStoredIntegrationKeys(): Promise<void> {
  try {
    const docs = await IntegrationSetting.find().sort({ updatedAt: 1 }).lean();
    let applied = 0;
    for (const doc of docs) {
      for (const [k, v] of Object.entries((doc.values ?? {}) as Record<string, string>)) {
        if (ALLOWED_VARS.has(k) && v) {
          process.env[k] = v;
          applied += 1;
        }
      }
    }
    if (applied) logger.info({ applied }, 'applied stored integration keys to env');
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'could not apply stored integration keys');
  }
}
