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
  propertyIntel: 'propertyIntel',
  quotations: 'quotations',
  invoicing: 'invoicing',
  deals: 'deals',
  ledger: 'ledger',
  documents: 'documents',
  cms: 'cms',
  analytics: 'analytics',
} as const;

export type ModuleFlag = (typeof MODULES)[keyof typeof MODULES];

/** Every module flag — future-proof source for the all-inclusive plan. */
export const ALL_MODULES = Object.values(MODULES) as ModuleFlag[];

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
      'propertyIntel',
      'quotations',
      'invoicing',
      'deals',
      'ledger',
      'documents',
      'cms',
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
      'propertyIntel',
      'quotations',
      'invoicing',
      'deals',
      'ledger',
      'documents',
      'cms',
    ] as ModuleFlag[],
  },
  /**
   * All-inclusive tier — every module, always. Modules are derived from MODULES
   * so any feature added later is automatically part of Ultimate.
   */
  ultimate: {
    key: 'ultimate',
    name: 'Ultimate',
    priceMonthly: 3997,
    modules: ALL_MODULES,
  },
} as const;

export type PlanKey = keyof typeof PLANS;

export function modulesForPlan(plan: PlanKey): ModuleFlag[] {
  return [...PLANS[plan].modules];
}

/** Metered usage types recorded in UsageLedger. */
export const USAGE_TYPES = ['voiceMinutes', 'smsSegments', 'leadCredits', 'aiTokens'] as const;
export type UsageType = (typeof USAGE_TYPES)[number];
