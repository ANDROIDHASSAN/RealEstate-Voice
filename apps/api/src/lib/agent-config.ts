import { getVoiceAgent, VOICE_AGENTS, VOICE_STUDIO_DEFAULTS, type Locale } from '@truecode/shared';
import { VoiceAgentConfig } from '../models.js';

/** Fully-resolved agent config used by the worker + returned to the studio. */
export interface EffectiveAgent {
  key: string;
  custom: boolean;
  enabled: boolean;
  name: string;
  language: Locale;
  purpose: string;
  firstMessage: string;
  systemPrompt: string;
  script: string[];
  transcriberProvider: string;
  transcriberModel: string;
  modelProvider: string;
  modelName: string;
  temperature: number;
  voiceProvider: string;
  voiceId: string;
  tools: string[];
  knowledgeDocIds: string[];
  status: 'live' | 'ready';
}

function fromPreset(key: string) {
  return getVoiceAgent(key);
}

/** Merge a preset (if any) with the account's stored override. */
export function mergeAgent(key: string, preset: ReturnType<typeof fromPreset>, override: Record<string, unknown> | null): EffectiveAgent {
  const o = (override ?? {}) as Record<string, unknown>;
  const firstMessage = (o.firstMessage as string) || preset?.script?.[0] || 'Hello, thanks for taking my call!';
  const script = preset?.script ?? [firstMessage];
  return {
    key,
    custom: Boolean(o.custom) || !preset,
    enabled: o.enabled === undefined ? true : Boolean(o.enabled),
    name: (o.name as string) || preset?.name || key,
    language: ((o.language as Locale) || preset?.language || 'en') as Locale,
    purpose: (o.purpose as string) || preset?.purpose || '',
    firstMessage,
    systemPrompt: (o.systemPrompt as string) || '',
    script,
    transcriberProvider: (o.transcriberProvider as string) || VOICE_STUDIO_DEFAULTS.transcriberProvider,
    transcriberModel: (o.transcriberModel as string) || VOICE_STUDIO_DEFAULTS.transcriberModel,
    modelProvider: (o.modelProvider as string) || VOICE_STUDIO_DEFAULTS.modelProvider,
    modelName: (o.modelName as string) || VOICE_STUDIO_DEFAULTS.modelName,
    temperature: typeof o.temperature === 'number' ? (o.temperature as number) : VOICE_STUDIO_DEFAULTS.temperature,
    voiceProvider: (o.voiceProvider as string) || VOICE_STUDIO_DEFAULTS.voiceProvider,
    voiceId: (o.voiceId as string) || preset?.voiceId || VOICE_STUDIO_DEFAULTS.voiceId,
    tools: (o.tools as string[]) || preset?.tools || ['bookAppointment', 'sendSms', 'endCall'],
    knowledgeDocIds: ((o.knowledgeDocIds as unknown[]) ?? []).map(String),
    status: preset?.status ?? 'ready',
  };
}

/** Resolve one agent (preset ⊕ override) for a given account. */
export async function getEffectiveAgent(accountId: string, key: string): Promise<EffectiveAgent | null> {
  const preset = fromPreset(key);
  const override = await VoiceAgentConfig.findOne({ accountId, key }).lean();
  if (!preset && !override) return null;
  return mergeAgent(key, preset, override as Record<string, unknown> | null);
}

/** Every agent visible to the account: all presets plus any custom-created ones. */
export async function listEffectiveAgents(accountId: string): Promise<EffectiveAgent[]> {
  const overrides = await VoiceAgentConfig.find({ accountId }).lean();
  const byKey = new Map(overrides.map((o) => [o.key, o as Record<string, unknown>]));
  const presetKeys = VOICE_AGENTS.map((a) => a.key);
  const customKeys = overrides.filter((o) => o.custom && !presetKeys.includes(o.key)).map((o) => o.key);
  return [
    ...VOICE_AGENTS.map((p) => mergeAgent(p.key, p, byKey.get(p.key) ?? null)),
    ...customKeys.map((k) => mergeAgent(k, undefined, byKey.get(k) ?? null)),
  ];
}
