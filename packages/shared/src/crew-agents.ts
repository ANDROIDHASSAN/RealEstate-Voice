/**
 * The 20 multi-agents (CrewAI roles) — config-driven data consumed by
 * services/agents (Python) and mirrored by the API's TS fallback router.
 * Compliance Guard is MANDATORY before every outbound action.
 */
export interface CrewAgentConfig {
  key: string;
  name: string;
  role: string;
  goal: string;
  /** Action types this agent may emit as next-best-action. */
  emits: string[];
  status: 'live' | 'ready';
}

export const CREW_AGENTS: CrewAgentConfig[] = [
  {
    key: 'router',
    name: 'Router',
    role: 'Traffic controller',
    goal: 'Read {lead, history, transcript, goal} and route to the right specialist agent.',
    emits: ['route'],
    status: 'live',
  },
  {
    key: 'compliance-guard',
    name: 'Compliance Guard',
    role: 'TCPA/DNC/quiet-hours gatekeeper',
    goal: 'Block any outbound that violates DNC, missing consent, or quiet hours (8am–9pm lead-local). Runs before EVERY outbound action.',
    emits: ['approve', 'block'],
    status: 'live',
  },
  {
    key: 'lead-scorer',
    name: 'Lead Scorer',
    role: 'Scoring analyst',
    goal: 'Score 0–100 from intent, urgency, budget, engagement; update lead.score.',
    emits: ['scoreLead'],
    status: 'live',
  },
  {
    key: 'next-best-action',
    name: 'Next-Best-Action',
    role: 'Play caller',
    goal: 'Given full lead context, output exactly one next action: call, sms, whatsapp, email, enrollSequence, book, or wait.',
    emits: ['call', 'sms', 'whatsapp', 'email', 'enrollSequence', 'book', 'wait'],
    status: 'live',
  },
  {
    key: 'buyer-strategist',
    name: 'Buyer-Journey Strategist',
    role: 'Buyer funnel expert',
    goal: 'Plan the buyer path: qualify → pre-approval → showings → offer.',
    emits: ['plan'],
    status: 'ready',
  },
  {
    key: 'seller-strategist',
    name: 'Seller-Journey Strategist',
    role: 'Listing funnel expert',
    goal: 'Plan the seller path: valuation → listing presentation → launch → offers.',
    emits: ['plan'],
    status: 'ready',
  },
  {
    key: 'objection-handler',
    name: 'Objection Handler',
    role: 'Sales psychologist',
    goal: 'Draft responses to objections found in transcripts (price, timing, commission).',
    emits: ['draftReply'],
    status: 'ready',
  },
  {
    key: 'scheduler',
    name: 'Scheduler',
    role: 'Calendar operator',
    goal: 'Find and book appointment slots; resolve conflicts and time zones.',
    emits: ['book'],
    status: 'ready',
  },
  {
    key: 'followup-strategist',
    name: 'Follow-up Strategist',
    role: 'Nurture planner',
    goal: 'Choose/adjust the right drip sequence and cadence per lead temperature.',
    emits: ['enrollSequence', 'pauseSequence'],
    status: 'ready',
  },
  {
    key: 'listing-expert',
    name: 'Listing Expert',
    role: 'Property data analyst',
    goal: 'Answer property questions using scraped listing data.',
    emits: ['draftReply'],
    status: 'ready',
  },
  {
    key: 'market-analyst',
    name: 'Market-Analysis Agent',
    role: 'Local market economist',
    goal: 'Produce quick market snapshots (comps, DOM, price trends) for a zip/area.',
    emits: ['report'],
    status: 'ready',
  },
  {
    key: 'content-writer',
    name: 'Content Writer',
    role: 'Real-estate copywriter',
    goal: 'Write listing descriptions, blog posts, and market updates in brand voice.',
    emits: ['draftContent'],
    status: 'ready',
  },
  {
    key: 'ig-caption',
    name: 'Instagram Caption Agent',
    role: 'Social media writer',
    goal: 'Generate scroll-stopping IG captions + hashtags, localized.',
    emits: ['draftContent'],
    status: 'live',
  },
  {
    key: 'whatsapp-reply',
    name: 'WhatsApp Reply Agent',
    role: 'Conversational responder',
    goal: 'Draft contextual WhatsApp replies using lead context + FAQ; escalate on buying intent.',
    emits: ['draftReply', 'escalate'],
    status: 'live',
  },
  {
    key: 'email-drafter',
    name: 'Email Drafter',
    role: 'Email copywriter',
    goal: 'Draft follow-up and nurture emails with merge fields.',
    emits: ['draftReply'],
    status: 'ready',
  },
  {
    key: 'crm-sync',
    name: 'CRM-Sync Agent',
    role: 'Data plumber',
    goal: 'Keep GHL/CRM contact records in sync with TrueCode AI lead state.',
    emits: ['syncCrm'],
    status: 'ready',
  },
  {
    key: 'translator',
    name: 'Translation Agent',
    role: 'Localizer',
    goal: 'Translate any outbound to the lead locale (en/es/ar/pt/ht) preserving merge fields.',
    emits: ['translate'],
    status: 'ready',
  },
  {
    key: 'sentiment-analyzer',
    name: 'Sentiment / Transcript Analyzer',
    role: 'Conversation analyst',
    goal: 'Extract sentiment, objections, and commitments from call transcripts.',
    emits: ['analyze'],
    status: 'ready',
  },
  {
    key: 'deal-coordinator',
    name: 'Deal Coordinator',
    role: 'Transaction manager',
    goal: 'Track contract-to-close checklist; nudge on missing docs and deadlines.',
    emits: ['task'],
    status: 'ready',
  },
  {
    key: 'reporting-insights',
    name: 'Reporting / Insights Agent',
    role: 'Analyst',
    goal: 'Summarize weekly performance and recommend one improvement.',
    emits: ['report'],
    status: 'ready',
  },
];

export function getCrewAgent(key: string): CrewAgentConfig | undefined {
  return CREW_AGENTS.find((a) => a.key === key);
}
