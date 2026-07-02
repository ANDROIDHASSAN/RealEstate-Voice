import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const accountSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: String,
    timezone: { type: String, default: 'America/New_York' },
    locale: { type: String, enum: ['en', 'es', 'ar', 'pt', 'ht'], default: 'en' },
    plan: { type: String, enum: ['starter', 'pro', 'empire', 'ultimate'], default: 'starter' },
    enabledModules: { type: [String], default: ['core', 'instantReply', 'analytics'] },
    stripeCustomerId: String,
    stripeSubId: String,
    ghl: {
      connected: { type: Boolean, default: false },
      locationId: String,
      apiKey: String,
    },
    twilioNumber: String,
    whatsappPhoneId: String,
    websiteSlug: { type: String, index: true, sparse: true, unique: true },
    ownerName: String,
    status: { type: String, enum: ['active', 'past_due', 'canceled', 'suspended'], default: 'active' },
    /** Custom instructions injected into every voice agent's system prompt. */
    voiceSystemPrompt: String,
  },
  { timestamps: true },
);

const userSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['owner', 'admin', 'agent', 'viewer'], default: 'owner' },
    /** Platform-level access — orthogonal to tenant role. */
    platformRole: { type: String, enum: ['user', 'superadmin'], default: 'user', index: true },
    status: { type: String, enum: ['active', 'suspended'], default: 'active' },
    invitedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    lastLoginAt: Date,
    refreshTokens: { type: [String], default: [] },
  },
  { timestamps: true },
);

const leadSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    firstName: { type: String, required: true },
    lastName: String,
    phone: { type: String, index: true },
    email: String,
    locale: { type: String, enum: ['en', 'es', 'ar', 'pt', 'ht'], default: 'en' },
    source: { type: String, default: 'website' },
    status: {
      type: String,
      enum: ['new', 'contacted', 'qualified', 'appointment', 'nurture', 'won', 'lost', 'dnc'],
      default: 'new',
      index: true,
    },
    intent: { type: String, enum: ['buyer', 'seller', 'renter', 'investor', 'unknown'], default: 'unknown' },
    urgency: { type: String, enum: ['now', '1-3mo', '3-6mo', '6mo+', 'unknown'], default: 'unknown' },
    budget: String,
    location: String,
    propertyInterest: String,
    score: { type: Number, default: 0 },
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
    firstResponseSeconds: Number,
    ghlContactId: String,
    consent: {
      sms: { type: Boolean, default: false },
      call: { type: Boolean, default: false },
      whatsapp: { type: Boolean, default: false },
      email: { type: Boolean, default: true },
    },
    lastContactedAt: Date,
  },
  { timestamps: true },
);
leadSchema.index({ accountId: 1, phone: 1 });
leadSchema.index({ accountId: 1, email: 1 });
leadSchema.index({ accountId: 1, createdAt: -1 });

const callSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    direction: { type: String, enum: ['inbound', 'outbound'], required: true },
    provider: { type: String, required: true },
    providerCallId: String,
    agentKey: { type: String, required: true },
    status: {
      type: String,
      enum: ['queued', 'ringing', 'in-progress', 'completed', 'failed', 'blocked'],
      default: 'queued',
    },
    durationSec: { type: Number, default: 0 },
    recordingUrl: String,
    transcript: [{ role: String, text: String, ts: Number, _id: false }],
    summary: String,
    outcome: String,
    bookedAppointmentId: { type: Schema.Types.ObjectId, ref: 'Appointment' },
  },
  { timestamps: true },
);

const appointmentSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    type: {
      type: String,
      enum: ['showing', 'listing-presentation', 'buyer-consult', 'call', 'other'],
      default: 'call',
    },
    calendarEventId: String,
    status: {
      type: String,
      enum: ['scheduled', 'completed', 'no-show', 'canceled'],
      default: 'scheduled',
    },
  },
  { timestamps: true },
);

const conversationSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    channel: { type: String, enum: ['sms', 'whatsapp', 'email', 'instagram'], required: true },
    messages: [
      {
        direction: { type: String, enum: ['inbound', 'outbound'] },
        text: String,
        ts: { type: Date, default: Date.now },
        status: String,
        meta: Schema.Types.Mixed,
        _id: false,
      },
    ],
    status: { type: String, enum: ['open', 'ai', 'human', 'closed'], default: 'ai' },
    lastInboundAt: Date,
  },
  { timestamps: true },
);
conversationSchema.index({ accountId: 1, leadId: 1, channel: 1 }, { unique: true });

const sequenceSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    name: { type: String, required: true },
    locale: { type: String, default: 'en' },
    steps: [{ delayHours: Number, channel: String, template: String, _id: false }],
  },
  { timestamps: true },
);

const dripEnrollmentSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
    sequenceId: { type: Schema.Types.ObjectId, ref: 'Sequence', required: true },
    currentStep: { type: Number, default: 0 },
    nextRunAt: Date,
    status: { type: String, enum: ['active', 'paused', 'completed', 'stopped'], default: 'active' },
    history: [{ step: Number, channel: String, sentAt: Date, status: String, _id: false }],
  },
  { timestamps: true },
);

const contentPostSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    channel: { type: String, default: 'instagram' },
    type: { type: String, enum: ['post', 'reel', 'story'], default: 'post' },
    caption: { type: String, required: true },
    mediaUrl: String,
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'published', 'stub-published', 'failed'],
      default: 'scheduled',
    },
  },
  { timestamps: true },
);

const agentRunSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    agentKey: { type: String, required: true },
    input: Schema.Types.Mixed,
    output: Schema.Types.Mixed,
    nextAction: Schema.Types.Mixed,
    status: { type: String, enum: ['running', 'done', 'error'], default: 'running' },
  },
  { timestamps: true },
);

const usageLedgerSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    type: { type: String, enum: ['voiceMinutes', 'smsSegments', 'leadCredits', 'aiTokens'], required: true },
    quantity: { type: Number, required: true },
    note: String,
    ts: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

const complianceSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
    dncList: { type: [String], default: [] },
    tcpaConsent: { type: Boolean, default: true },
    quietHours: {
      start: { type: Number, default: 8 },
      end: { type: Number, default: 21 },
    },
    blockedLog: [
      { channel: String, to: String, reason: String, ts: { type: Date, default: Date.now }, _id: false },
    ],
  },
  { timestamps: true },
);

const scrapeJobSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    source: { type: String, required: true },
    query: { type: String, required: true },
    maxResults: { type: Number, default: 25 },
    country: String,
    city: String,
    personaKey: String,
    filters: Schema.Types.Mixed,
    status: { type: String, enum: ['queued', 'running', 'done', 'error'], default: 'queued' },
    found: { type: Number, default: 0 },
    imported: { type: Number, default: 0 },
    error: String,
  },
  { timestamps: true },
);

const videoJobSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    title: { type: String, required: true },
    script: { type: String, required: true },
    status: { type: String, enum: ['queued', 'rendering', 'done', 'error'], default: 'queued' },
    renderUrl: String,
    stub: { type: Boolean, default: false },
    error: String,
  },
  { timestamps: true },
);

/**
 * Knowledge base for RAG — per account. Each document is split into chunks;
 * when an embeddings key is set, each chunk carries a vector for semantic
 * search, otherwise retrieval falls back to keyword scoring over `text`.
 */
const knowledgeDocSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    title: { type: String, required: true },
    source: { type: String, default: 'manual' },
    chunkCount: { type: Number, default: 0 },
    embedded: { type: Boolean, default: false },
    chunks: [{ text: String, embedding: { type: [Number], default: undefined }, _id: false }],
  },
  { timestamps: true },
);

/**
 * Per-account provider credentials configured from Settings. Values are
 * stored server-side only and always masked in API responses. On boot (and
 * on save) they are applied to process.env so integration clients pick them
 * up — single-instance semantics, documented in DECISIONS.md.
 */
const integrationSettingSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    provider: { type: String, required: true },
    values: { type: Map, of: String, default: {} },
  },
  { timestamps: true },
);
integrationSettingSchema.index({ accountId: 1, provider: 1 }, { unique: true });

/**
 * Property Intelligence — a saved multi-agent investment analysis.
 * `input` is the property the user submitted; `report` is the full orchestrated
 * AnalysisReport (typed in @truecode/shared). Runs asynchronously through the
 * property-analysis queue, mirroring the AgentRun lifecycle (running→done/error).
 * `chat` holds the report-scoped AI assistant thread.
 */
const propertyAnalysisSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    label: { type: String, required: true },
    address: { type: String, required: true },
    city: String,
    state: String,
    input: { type: Schema.Types.Mixed, required: true },
    report: Schema.Types.Mixed,
    investmentScore: { type: Number, default: 0 },
    grade: String,
    recommendation: String,
    riskLevel: String,
    status: { type: String, enum: ['running', 'done', 'error'], default: 'running', index: true },
    error: String,
    enriched: { type: Boolean, default: false },
    watch: { type: Boolean, default: false },
    chat: [{ role: { type: String, enum: ['user', 'assistant'] }, text: String, ts: { type: Date, default: Date.now }, _id: false }],
  },
  { timestamps: true },
);
propertyAnalysisSchema.index({ accountId: 1, createdAt: -1 });

/**
 * Quotations & Proposals — branded sales documents an owner sends to clients.
 * Totals are always recomputed server-side (see @truecode/shared computeTotals);
 * the stored `totals` is a cache for lists/PDF and is never trusted from input.
 */
const quoteSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    number: { type: String, required: true },
    title: { type: String, required: true },
    client: {
      name: { type: String, required: true },
      email: String,
      phone: String,
      address: String,
    },
    propertyAddress: String,
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    templateKey: String,
    lineItems: [{ description: String, category: String, quantity: Number, unitPrice: Number, _id: false }],
    currency: { type: String, default: 'USD' },
    taxRatePct: { type: Number, default: 0 },
    discountType: { type: String, enum: ['none', 'percent', 'amount'], default: 'none' },
    discountValue: { type: Number, default: 0 },
    totals: Schema.Types.Mixed,
    notes: String,
    terms: String,
    validUntil: Date,
    status: {
      type: String,
      enum: ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'],
      default: 'draft',
      index: true,
    },
    sentAt: Date,
    viewedAt: Date,
    respondedAt: Date,
    publicToken: { type: String, index: true, sparse: true },
  },
  { timestamps: true },
);
quoteSchema.index({ accountId: 1, createdAt: -1 });

const clientSub = {
  name: { type: String, required: true },
  email: String,
  phone: String,
  address: String,
};
const lineItemSub = [{ description: String, category: String, quantity: Number, unitPrice: Number, _id: false }];

/** Invoicing & Payments — money owed by a client, with a payment ledger. */
const invoiceSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    number: { type: String, required: true },
    title: { type: String, required: true },
    client: clientSub,
    propertyAddress: String,
    quoteId: { type: Schema.Types.ObjectId, ref: 'Quote' },
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal' },
    lineItems: lineItemSub,
    currency: { type: String, default: 'USD' },
    taxRatePct: { type: Number, default: 0 },
    discountType: { type: String, enum: ['none', 'percent', 'amount'], default: 'none' },
    discountValue: { type: Number, default: 0 },
    totals: Schema.Types.Mixed,
    payments: [{ amount: Number, method: String, note: String, ts: { type: Date, default: Date.now }, _id: false }],
    amountPaid: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    notes: String,
    dueDate: Date,
    status: { type: String, enum: ['draft', 'sent', 'paid', 'partial', 'overdue', 'void'], default: 'draft', index: true },
    sentAt: Date,
    paidAt: Date,
    publicToken: { type: String, index: true, sparse: true },
  },
  { timestamps: true },
);
invoiceSchema.index({ accountId: 1, createdAt: -1 });

/** Deal Pipeline — a transaction moving through stages, with tasks. */
const dealSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    title: { type: String, required: true },
    clientName: { type: String, required: true },
    propertyAddress: String,
    side: { type: String, enum: ['buyer', 'seller', 'both'], default: 'buyer' },
    stage: {
      type: String,
      enum: ['lead', 'appointment', 'offer', 'under-contract', 'closing', 'closed-won', 'closed-lost'],
      default: 'lead',
      index: true,
    },
    value: { type: Number, default: 0 },
    commissionPct: { type: Number, default: 3 },
    expectedCloseDate: Date,
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    notes: String,
    tasks: [{ title: String, done: { type: Boolean, default: false }, dueDate: Date, _id: false }],
    closedAt: Date,
  },
  { timestamps: true },
);
dealSchema.index({ accountId: 1, stage: 1 });

/** Commission & Expense Ledger — income/expense book for the business. */
const ledgerEntrySchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    type: { type: String, enum: ['income', 'expense'], required: true },
    category: { type: String, required: true },
    description: String,
    amount: { type: Number, required: true },
    date: { type: Date, required: true },
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal' },
  },
  { timestamps: true },
);
ledgerEntrySchema.index({ accountId: 1, date: -1 });

/** Documents & E-sign — an agreement/disclosure a client accepts + signs. */
const documentRecordSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    number: { type: String, required: true },
    title: { type: String, required: true },
    templateKey: String,
    client: { name: { type: String, required: true }, email: String },
    propertyAddress: String,
    body: { type: String, required: true },
    dealId: { type: Schema.Types.ObjectId, ref: 'Deal' },
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    status: { type: String, enum: ['draft', 'sent', 'viewed', 'signed', 'declined'], default: 'draft', index: true },
    signature: { name: String, signedAt: Date, ip: String },
    sentAt: Date,
    publicToken: { type: String, index: true, sparse: true },
  },
  { timestamps: true },
);
documentRecordSchema.index({ accountId: 1, createdAt: -1 });

/** CMS — per-account website settings (brand, theme, nav, SEO). One per account. */
const siteConfigSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, unique: true, index: true },
    brandName: String,
    tagline: String,
    logoUrl: String,
    theme: {
      primaryColor: String,
      accentColor: String,
      bgColor: String,
      font: { type: String, enum: ['sans', 'serif'], default: 'sans' },
    },
    contact: { phone: String, email: String, address: String },
    social: { facebook: String, instagram: String, linkedin: String, youtube: String, x: String },
    seo: { metaTitle: String, metaDescription: String, ogImage: String, noindex: Boolean },
    nav: [{ label: String, href: String, _id: false }],
    footerText: String,
    published: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// A block sub-schema is required because a subdocument field named `type`
// would otherwise be interpreted by Mongoose as a SchemaType declaration
// (turning `blocks` into `[String]`). An explicit Schema forces path semantics.
const cmsBlockSchema = new Schema(
  { id: String, type: String, data: Schema.Types.Mixed },
  { _id: false },
);

/** CMS — a page or blog post built from content blocks. */
const cmsContentSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    type: { type: String, enum: ['page', 'post'], default: 'page', index: true },
    title: { type: String, required: true },
    slug: { type: String, required: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    excerpt: String,
    coverImageUrl: String,
    blocks: [cmsBlockSchema],
    seo: { metaTitle: String, metaDescription: String, ogImage: String, noindex: Boolean },
    tags: { type: [String], default: [] },
    showInNav: { type: Boolean, default: false },
    navOrder: { type: Number, default: 0 },
    isHome: { type: Boolean, default: false },
    views: { type: Number, default: 0 },
    publishedAt: Date,
  },
  { timestamps: true },
);
cmsContentSchema.index({ accountId: 1, type: 1, slug: 1 }, { unique: true });
cmsContentSchema.index({ accountId: 1, updatedAt: -1 });

function model<T extends Schema>(name: string, schema: T): Model<InferSchemaType<T>> {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}
export const PropertyAnalysis = model('PropertyAnalysis', propertyAnalysisSchema);
export const SiteConfig = model('SiteConfig', siteConfigSchema);
export const CmsContent = model('CmsContent', cmsContentSchema);
export const Quote = model('Quote', quoteSchema);
export const Invoice = model('Invoice', invoiceSchema);
export const Deal = model('Deal', dealSchema);
export const LedgerEntry = model('LedgerEntry', ledgerEntrySchema);
export const DocumentRecord = model('DocumentRecord', documentRecordSchema);

export const Account = model('Account', accountSchema);
export const User = model('User', userSchema);
export const Lead = model('Lead', leadSchema);
export const Call = model('Call', callSchema);
export const Appointment = model('Appointment', appointmentSchema);
export const Conversation = model('Conversation', conversationSchema);
export const Sequence = model('Sequence', sequenceSchema);
export const DripEnrollment = model('DripEnrollment', dripEnrollmentSchema);
export const ContentPost = model('ContentPost', contentPostSchema);
export const AgentRun = model('AgentRun', agentRunSchema);
export const UsageLedger = model('UsageLedger', usageLedgerSchema);
export const Compliance = model('Compliance', complianceSchema);
export const ScrapeJob = model('ScrapeJob', scrapeJobSchema);
export const VideoJob = model('VideoJob', videoJobSchema);
/**
 * Per-account voice-agent configuration — a Vapi-style builder. Overrides a
 * preset (by key) or defines a fully custom agent (custom:true). Every field
 * the studio exposes lives here: identity, first message, system prompt, the
 * transcriber (STT), model (LLM), voice (TTS), tools, and attached KB docs.
 */
const voiceAgentConfigSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    key: { type: String, required: true },
    custom: { type: Boolean, default: false },
    enabled: { type: Boolean, default: true },
    name: String,
    language: { type: String, enum: ['en', 'es', 'ar', 'pt', 'ht'], default: 'en' },
    purpose: String,
    firstMessage: String,
    systemPrompt: String,
    transcriberProvider: String,
    transcriberModel: String,
    modelProvider: String,
    modelName: String,
    temperature: { type: Number, min: 0, max: 2, default: 0.5 },
    voiceProvider: String,
    voiceId: String,
    tools: { type: [String], default: undefined },
    knowledgeDocIds: { type: [Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true },
);
voiceAgentConfigSchema.index({ accountId: 1, key: 1 }, { unique: true });

export const IntegrationSetting = model('IntegrationSetting', integrationSettingSchema);
export const KnowledgeDoc = model('KnowledgeDoc', knowledgeDocSchema);
export const VoiceAgentConfig = model('VoiceAgentConfig', voiceAgentConfigSchema);
