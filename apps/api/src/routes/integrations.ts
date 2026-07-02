import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { apify, getLLM, instagram, resend, stripe, twilio, video, whatsapp } from '@closeflow/integrations';
import { getVoiceProvider } from '@closeflow/voice';
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
interface ProviderDef {
  key: string;
  name: string;
  docsUrl: string;
  fields: ProviderField[];
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
    name: 'AI brain (Gemini / Groq)',
    docsUrl: 'https://aistudio.google.com/apikey',
    fields: [
      { var: 'GEMINI_API_KEY', label: 'Gemini API key', secret: true },
      { var: 'GROQ_API_KEY', label: 'Groq API key (fallback)', secret: true },
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
  },
  {
    key: 'voice',
    name: 'Voice provider (Vapi / Dograh)',
    docsUrl: 'https://dashboard.vapi.ai',
    fields: [
      { var: 'VAPI_API_KEY', label: 'Vapi API key', secret: true },
      { var: 'DOGRAH_BASE_URL', label: 'Dograh self-hosted URL', secret: false },
      { var: 'DOGRAH_API_KEY', label: 'Dograh API key', secret: true },
    ],
  },
];

const ALLOWED_VARS = new Set(PROVIDER_CATALOG.flatMap((p) => p.fields.map((f) => f.var)));

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

  const entries = Object.entries(parsed.data.values).filter(
    ([k, v]) => ALLOWED_VARS.has(k) && def.fields.some((f) => f.var === k) && v.trim().length > 0,
  );
  if (!entries.length) return res.status(400).json({ error: 'no_valid_keys' });

  const doc = await IntegrationSetting.findOneAndUpdate(
    { accountId: req.auth!.accountId, provider: def.key },
    { $set: Object.fromEntries(entries.map(([k, v]) => [`values.${k}`, v.trim()])) },
    { new: true, upsert: true },
  );
  for (const [k, v] of entries) process.env[k] = v.trim();
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
