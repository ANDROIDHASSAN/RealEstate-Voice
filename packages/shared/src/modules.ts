/** Module flags — the single source of truth for plan gating. */
export const MODULES = {
  core: 'core',
  instantReply: 'instantReply',
  voice: 'voice',
  followup: 'followup',
  whatsapp: 'whatsapp',
  leadEngine: 'leadEngine',
  instagram: 'instagram',
  website: 'website',
  content: 'content',
  multiAgent: 'multiAgent',
  analytics: 'analytics',
} as const;

export type ModuleFlag = (typeof MODULES)[keyof typeof MODULES];

export const PLANS = {
  starter: {
    key: 'starter',
    name: 'Starter',
    priceMonthly: 297,
    modules: ['core', 'instantReply', 'analytics'] as ModuleFlag[],
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    priceMonthly: 997,
    modules: [
      'core',
      'instantReply',
      'analytics',
      'voice',
      'followup',
      'whatsapp',
    ] as ModuleFlag[],
  },
  empire: {
    key: 'empire',
    name: 'Empire',
    priceMonthly: 1997,
    modules: [
      'core',
      'instantReply',
      'analytics',
      'voice',
      'followup',
      'whatsapp',
      'leadEngine',
      'instagram',
      'website',
      'content',
      'multiAgent',
    ] as ModuleFlag[],
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function modulesForPlan(plan: PlanKey): ModuleFlag[] {
  return [...PLANS[plan].modules];
}

/** Metered usage types recorded in UsageLedger. */
export const USAGE_TYPES = ['voiceMinutes', 'smsSegments', 'leadCredits', 'aiTokens'] as const;
export type UsageType = (typeof USAGE_TYPES)[number];
