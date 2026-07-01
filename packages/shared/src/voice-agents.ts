import type { Locale } from './types.js';

export interface VoiceAgentConfig {
  key: string;
  name: string;
  language: Locale;
  voiceId: string;
  purpose: string;
  /** Ordered conversation script; {{merge}} fields resolved from lead/account. */
  script: string[];
  tools: ('bookAppointment' | 'transferCall' | 'sendSms' | 'tagLead' | 'endCall')[];
  transferRule: string;
  status: 'live' | 'ready';
}

const disclose = 'This call may be recorded for quality purposes.';

export const VOICE_AGENTS: VoiceAgentConfig[] = [
  {
    key: 'inbound-receptionist',
    name: 'Inbound Receptionist',
    language: 'en',
    voiceId: 'aria',
    purpose: 'After-hours pickup: greet, capture intent, take a message or book.',
    script: [
      `Hi, thanks for calling {{account.name}}! ${disclose} How can I help you today?`,
      'Are you calling about buying, selling, or renting a property?',
      'Got it — can I grab your name and the best number to reach you?',
      'Would you like me to book a quick call with {{account.ownerName}}? What time works for you?',
      'Perfect, you are booked. You will get a text confirmation shortly. Anything else?',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'endCall'],
    transferRule: 'If caller says "urgent" or asks for a human, transfer to {{account.phone}}.',
    status: 'live',
  },
  {
    key: 'buyer-qualifier',
    name: 'Buyer Qualifier',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Qualify buyer leads: intent, budget, timeline, pre-approval, book consult.',
    script: [
      `Hi {{lead.firstName}}, this is the assistant for {{account.name}}. ${disclose} You asked about buying — still looking?`,
      'What area are you focused on, and what kind of home?',
      'What price range are you comfortable with?',
      'Are you pre-approved for a mortgage, or paying cash?',
      'When would you ideally like to move — right away, or within a few months?',
      'Great — let me book you a buyer consult with {{account.ownerName}}. Morning or afternoon?',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'transferCall', 'endCall'],
    transferRule: 'If budget > $1M and timeline = now, warm-transfer immediately.',
    status: 'ready',
  },
  {
    key: 'seller-qualifier',
    name: 'Seller / Listing Qualifier',
    language: 'en',
    voiceId: 'marcus',
    purpose: 'Qualify seller leads: property, motivation, timeline, book listing presentation.',
    script: [
      `Hi {{lead.firstName}}, calling from {{account.name}} about your property. ${disclose}`,
      'Are you thinking about selling {{lead.propertyInterest}}?',
      'What is prompting the move, if you do not mind me asking?',
      'When would you want to be sold and moved by?',
      'Would a free valuation help? I can book {{account.ownerName}} to walk the property.',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'transferCall', 'endCall'],
    transferRule: 'If seller wants to list within 30 days, warm-transfer.',
    status: 'ready',
  },
  {
    key: 'renter-qualifier',
    name: 'Renter Qualifier',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Qualify rental leads: budget, move date, requirements, book showing.',
    script: [
      `Hi {{lead.firstName}}! ${disclose} You asked about a rental — what is your monthly budget?`,
      'When do you need to move in?',
      'How many bedrooms, and any must-haves like parking or pets?',
      'I can set up a showing — what day works?',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'endCall'],
    transferRule: 'Never transfer; book or take a message.',
    status: 'ready',
  },
  {
    key: 'speed-to-lead',
    name: 'Speed-to-Lead First Call',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Fires from Instant Reply within seconds of a new lead. Qualify + book on the first touch.',
    script: [
      `Hi {{lead.firstName}}, you just reached out about {{lead.propertyInterest}} — this is {{account.name}}'s assistant calling you right back! ${disclose}`,
      'Are you looking to buy, sell, or rent?',
      'What is your rough budget or price expectation?',
      'How soon are you looking to make a move?',
      'The best next step is a quick call with {{account.ownerName}} — can I book you in for tomorrow?',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'transferCall', 'endCall'],
    transferRule: 'If lead is ready now and agent is available, warm-transfer live.',
    status: 'live',
  },
  {
    key: 'appointment-booker',
    name: 'Appointment Booker',
    language: 'en',
    voiceId: 'marcus',
    purpose: 'Single-purpose closer: find a slot and book it.',
    script: [
      `Hi {{lead.firstName}}, quick call from {{account.name}} to get your appointment locked in. ${disclose}`,
      'Does {{suggestedSlot}} work for you, or would another time be better?',
      'Booked! You will get a confirmation by text. See you then.',
    ],
    tools: ['bookAppointment', 'sendSms', 'endCall'],
    transferRule: 'If lead has questions the script cannot answer, offer a callback.',
    status: 'live',
  },
  {
    key: 'appointment-reminder',
    name: 'Appointment Reminder / No-show Rescue',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Remind before appointments; reschedule no-shows.',
    script: [
      `Hi {{lead.firstName}}, reminding you about your appointment with {{account.ownerName}} at {{appointment.startsAt}}. ${disclose}`,
      'Are you still good for that time? I can move it if needed.',
    ],
    tools: ['bookAppointment', 'sendSms', 'endCall'],
    transferRule: 'None.',
    status: 'ready',
  },
  {
    key: 'fsbo-outreach',
    name: 'FSBO Outreach',
    language: 'en',
    voiceId: 'marcus',
    purpose: 'Call for-sale-by-owner listings; offer help without pressure.',
    script: [
      `Hi, I am calling on behalf of {{account.name}} about the home you are selling yourself. ${disclose}`,
      'How is the sale going so far? Getting the traffic you hoped for?',
      'If it does not sell in the next few weeks, would you be open to hearing how {{account.ownerName}} sells similar homes?',
      'Can I book a no-obligation 15-minute call?',
    ],
    tools: ['bookAppointment', 'tagLead', 'endCall'],
    transferRule: 'If hostile or on DNC, tag and end politely.',
    status: 'ready',
  },
  {
    key: 'expired-listing',
    name: 'Expired-Listing Outreach',
    language: 'en',
    voiceId: 'marcus',
    purpose: 'Re-engage owners whose listings expired unsold.',
    script: [
      `Hi, calling from {{account.name}}. ${disclose} I noticed your listing recently came off the market — did you sell?`,
      'What do you think stopped it from selling?',
      '{{account.ownerName}} specializes in relisting homes like yours — worth a quick chat?',
    ],
    tools: ['bookAppointment', 'tagLead', 'endCall'],
    transferRule: 'If owner is angry about agents, apologize and end.',
    status: 'ready',
  },
  {
    key: 'open-house-followup',
    name: 'Open-House Follow-up',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Call open-house sign-ins within 24h; gauge interest, book next step.',
    script: [
      `Hi {{lead.firstName}}, thanks for visiting the open house at {{lead.propertyInterest}}! ${disclose}`,
      'What did you think of the home?',
      'Are you actively looking, or early in the process?',
      'Want me to set up a private showing or send similar listings?',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'endCall'],
    transferRule: 'None.',
    status: 'ready',
  },
  {
    key: 'past-client-reactivation',
    name: 'Past-Client Reactivation',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Warm check-in with past clients; surface new needs and referrals.',
    script: [
      `Hi {{lead.firstName}}, it is {{account.name}}'s office checking in! ${disclose} How is the home treating you?`,
      'Any plans to upsize, downsize, or invest this year?',
      'Anyone in your circle thinking about buying or selling that we should take great care of?',
    ],
    tools: ['tagLead', 'sendSms', 'bookAppointment', 'endCall'],
    transferRule: 'None.',
    status: 'ready',
  },
  {
    key: 'referral-asker',
    name: 'Referral Asker',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Post-close referral request call.',
    script: [
      `Hi {{lead.firstName}}, congrats again on the closing! ${disclose}`,
      'Quick favor — who is one person you know who might buy or sell in the next year?',
      'Amazing. We will treat them like family. Thank you!',
    ],
    tools: ['tagLead', 'sendSms', 'endCall'],
    transferRule: 'None.',
    status: 'ready',
  },
  {
    key: 'price-reduction-notifier',
    name: 'Price-Reduction Notifier',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Notify matched buyers when a watched property drops in price.',
    script: [
      `Hi {{lead.firstName}}, good news — {{lead.propertyInterest}} just dropped in price. ${disclose}`,
      'Want to see it before it goes? I can book a showing this week.',
    ],
    tools: ['bookAppointment', 'sendSms', 'endCall'],
    transferRule: 'None.',
    status: 'ready',
  },
  {
    key: 'showing-feedback',
    name: 'Showing Feedback Collector',
    language: 'en',
    voiceId: 'marcus',
    purpose: 'Collect feedback from buyer agents/buyers after showings.',
    script: [
      `Hi, quick call from {{account.name}} about the showing at {{lead.propertyInterest}}. ${disclose}`,
      'On a scale of 1 to 10, how did your client like the home?',
      'Any feedback on price or condition?',
      'Thanks — this really helps the seller.',
    ],
    tools: ['tagLead', 'endCall'],
    transferRule: 'None.',
    status: 'ready',
  },
  {
    key: 'buyer-qualifier-es',
    name: 'Spanish Buyer Qualifier',
    language: 'es',
    voiceId: 'lucia',
    purpose: 'Qualify Spanish-speaking buyer leads end-to-end in Spanish.',
    script: [
      'Hola {{lead.firstName}}, le habla la asistente de {{account.name}}. Esta llamada puede ser grabada. ¿Sigue buscando comprar una propiedad?',
      '¿En qué zona está buscando y qué tipo de casa?',
      '¿Cuál es su presupuesto aproximado?',
      '¿Ya tiene una pre-aprobación hipotecaria o pagaría en efectivo?',
      '¿Para cuándo le gustaría mudarse?',
      'Perfecto — le agendo una consulta con {{account.ownerName}}. ¿Mañana o tarde?',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'transferCall', 'endCall'],
    transferRule: 'Si el presupuesto supera $1M y quiere comprar ya, transferir en vivo.',
    status: 'ready',
  },
  {
    key: 'buyer-seller-ar',
    name: 'Arabic Buyer/Seller Agent',
    language: 'ar',
    voiceId: 'omar',
    purpose: 'Qualify Arabic-speaking buyers/sellers (Saudi market), RTL-aware texting.',
    script: [
      'مرحباً {{lead.firstName}}، معك مساعد {{account.name}}. قد يتم تسجيل هذه المكالمة. هل ما زلت مهتماً بالعقار؟',
      'هل ترغب في الشراء أم البيع؟',
      'ما هي الميزانية التقريبية أو السعر المتوقع؟',
      'ما هو الإطار الزمني المناسب لك؟',
      'ممتاز — سأحجز لك موعداً مع {{account.ownerName}}. هل يناسبك الصباح أم المساء؟',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'transferCall', 'endCall'],
    transferRule: 'العملاء الجادون خلال ٣٠ يوماً يتم تحويلهم مباشرة.',
    status: 'ready',
  },
  {
    key: 'qualifier-pt',
    name: 'Portuguese Qualifier',
    language: 'pt',
    voiceId: 'ana',
    purpose: 'Qualify Portuguese-speaking (Brazilian) leads in Miami market.',
    script: [
      'Olá {{lead.firstName}}, aqui é a assistente de {{account.name}}. Esta chamada pode ser gravada. Ainda está procurando imóvel?',
      'Em qual região e que tipo de imóvel?',
      'Qual é o seu orçamento aproximado?',
      'Quando pretende se mudar?',
      'Ótimo — vou agendar uma conversa com {{account.ownerName}}. Manhã ou tarde?',
    ],
    tools: ['bookAppointment', 'sendSms', 'tagLead', 'endCall'],
    transferRule: 'Transferir se o lead quiser fechar em 30 dias.',
    status: 'ready',
  },
  {
    key: 'investor-screener',
    name: 'Investor / Cash-Buyer Screener',
    language: 'en',
    voiceId: 'marcus',
    purpose: 'Screen investors: strategy, capital, target cap rate, book deal-flow call.',
    script: [
      `Hi {{lead.firstName}}, calling from {{account.name}} about investment opportunities. ${disclose}`,
      'What is your strategy — flips, buy-and-hold, or short-term rentals?',
      'What capital range are you deploying per deal?',
      'Are you buying cash or financing?',
      'I will get you on {{account.ownerName}}\'s deal-flow list and book an intro call.',
    ],
    tools: ['bookAppointment', 'tagLead', 'sendSms', 'endCall'],
    transferRule: 'Cash buyers > $500k get warm-transferred.',
    status: 'ready',
  },
  {
    key: 'tenant-maintenance',
    name: 'Tenant Maintenance Intake',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Property-management intake: capture issue, severity, schedule vendor window.',
    script: [
      `Hi, you have reached {{account.name}} maintenance line. ${disclose} What is the issue?`,
      'Is anything actively leaking, sparking, or unsafe right now?',
      'What is the unit address and the best callback number?',
      'A vendor window will be texted to you shortly. Anything else?',
    ],
    tools: ['sendSms', 'tagLead', 'transferCall', 'endCall'],
    transferRule: 'Emergencies (fire/flood/gas) transfer to emergency line immediately.',
    status: 'ready',
  },
  {
    key: 'nps-survey',
    name: 'Survey / NPS Caller',
    language: 'en',
    voiceId: 'aria',
    purpose: 'Post-transaction NPS survey; flag detractors for follow-up.',
    script: [
      `Hi {{lead.firstName}}, one-minute survey from {{account.name}}. ${disclose}`,
      'From 0 to 10, how likely are you to recommend {{account.ownerName}}?',
      'What is the one thing we could have done better?',
      'Thank you — we really appreciate it!',
    ],
    tools: ['tagLead', 'endCall'],
    transferRule: 'Scores <= 6 create a follow-up task for the owner.',
    status: 'ready',
  },
];

export const LIVE_VOICE_AGENT_KEYS = VOICE_AGENTS.filter((a) => a.status === 'live').map(
  (a) => a.key,
);

export function getVoiceAgent(key: string): VoiceAgentConfig | undefined {
  return VOICE_AGENTS.find((a) => a.key === key);
}

/** Pick the best qualifier agent for a lead's locale. */
export function voiceAgentForLocale(locale: string): VoiceAgentConfig {
  const map: Record<string, string> = {
    es: 'buyer-qualifier-es',
    ar: 'buyer-seller-ar',
    pt: 'qualifier-pt',
  };
  return getVoiceAgent(map[locale] ?? 'speed-to-lead') ?? VOICE_AGENTS[0]!;
}
