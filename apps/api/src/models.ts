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
    /** Everything captured from the lead source (Apify Google Places, etc.). */
    scraped: {
      businessName: String,
      rating: Number,
      reviewsCount: Number,
      website: String,
      category: String,
      address: String,
      googleMapsUrl: String,
      sourceDetail: String,
    },
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
    /** Multi-platform targets (instagram/facebook/youtube/tiktok/linkedin). */
    platforms: { type: [String], default: ['instagram'] },
    type: { type: String, enum: ['post', 'reel', 'story'], default: 'post' },
    format: { type: String, default: 'feed-square' },
    title: String,
    caption: { type: String, required: true },
    firstComment: String,
    mediaUrl: String,
    mediaUrls: { type: [String], default: [] },
    mediaAssetIds: { type: [Schema.Types.ObjectId], default: [] },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['draft', 'scheduled', 'publishing', 'published', 'partial', 'stub-published', 'failed'],
      default: 'scheduled',
    },
    /** Per-platform publish outcome (set by the content worker). */
    results: {
      type: [
        {
          platform: String,
          status: String,
          externalId: String,
          permalink: String,
          error: String,
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
contentPostSchema.index({ accountId: 1, scheduledAt: 1 });

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

// ── Content Studio v2 ────────────────────────────────────────────────────────

/** Reusable media (images/videos) for the Content Studio library. */
const mediaAssetSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    name: { type: String, required: true },
    kind: { type: String, enum: ['image', 'video'], required: true },
    url: { type: String, required: true },
    thumbnailUrl: String,
    aspect: { type: String, enum: ['1:1', '4:5', '9:16', '16:9', 'other'], default: 'other' },
    width: Number,
    height: Number,
    durationSec: Number,
    sizeBytes: Number,
    tags: { type: [String], default: [] },
    source: { type: String, enum: ['upload', 'ai-generated', 'stock', 'url'], default: 'upload' },
    stub: { type: Boolean, default: false },
  },
  { timestamps: true },
);
mediaAssetSchema.index({ accountId: 1, createdAt: -1 });

/** A connected social account (one per platform per account). */
const socialConnectionSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    platform: { type: String, enum: ['instagram', 'facebook', 'youtube', 'tiktok', 'linkedin'], required: true },
    status: { type: String, enum: ['connected', 'pending', 'disconnected', 'error'], default: 'disconnected' },
    displayName: String,
    externalId: String,
    scopes: { type: [String], default: [] },
    connectedAt: Date,
    stub: { type: Boolean, default: false },
    reason: String,
  },
  { timestamps: true },
);
socialConnectionSchema.index({ accountId: 1, platform: 1 }, { unique: true });

/** A realtor ad campaign (Meta Marketing API adapter behind it). */
const adCampaignSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    name: { type: String, required: true },
    objective: { type: String, default: 'LEADS' },
    platform: { type: String, enum: ['meta', 'google', 'youtube', 'tiktok'], default: 'meta' },
    status: {
      type: String,
      enum: ['draft', 'pending_review', 'active', 'paused', 'completed', 'failed'],
      default: 'draft',
    },
    budgetDaily: { type: Number, required: true },
    durationDays: { type: Number, default: 7 },
    currency: { type: String, default: 'USD' },
    startAt: Date,
    endAt: Date,
    creative: {
      headline: String,
      primaryText: String,
      cta: { type: String, default: 'LEARN_MORE' },
      imageUrl: String,
      linkUrl: String,
    },
    fromPostId: { type: Schema.Types.ObjectId, ref: 'ContentPost' },
    targeting: Schema.Types.Mixed,
    externalId: String,
    stub: { type: Boolean, default: false },
    error: String,
    metrics: {
      impressions: { type: Number, default: 0 },
      reach: { type: Number, default: 0 },
      clicks: { type: Number, default: 0 },
      ctr: { type: Number, default: 0 },
      spend: { type: Number, default: 0 },
      leads: { type: Number, default: 0 },
      cpl: { type: Number, default: 0 },
      daily: { type: [{ date: String, impressions: Number, clicks: Number, spend: Number, leads: Number, _id: false }], default: [] },
    },
    metricsUpdatedAt: Date,
  },
  { timestamps: true },
);
adCampaignSchema.index({ accountId: 1, createdAt: -1 });

/** A competitor-research run against the Meta Ad Library. */
const adResearchSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    query: { type: String, required: true },
    region: { type: String, default: 'US' },
    platform: { type: String, default: 'all' },
    count: { type: Number, default: 20 },
    stub: { type: Boolean, default: false },
    provider: { name: String, live: Boolean, reason: String },
  },
  { timestamps: true },
);
adResearchSchema.index({ accountId: 1, createdAt: -1 });

/** One competitor ad captured from an Ad Library research run. */
const competitorAdSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    researchId: { type: Schema.Types.ObjectId, ref: 'AdResearch', index: true },
    advertiser: String,
    page: String,
    platform: String,
    headline: String,
    primaryText: String,
    cta: String,
    mediaType: { type: String, enum: ['image', 'video', 'carousel'], default: 'image' },
    thumbnailUrl: String,
    startedRunning: Date,
    daysRunning: Number,
    estimatedSpend: String,
    impressionsRange: String,
    angle: String,
    sourceUrl: String,
    watched: { type: Boolean, default: false },
  },
  { timestamps: true },
);
competitorAdSchema.index({ accountId: 1, createdAt: -1 });
competitorAdSchema.index({ accountId: 1, watched: 1 });

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
    lineItems: [{
      description: String, category: String, unit: String, quantity: Number, unitPrice: Number,
      discountPct: Number, taxable: Boolean, optional: Boolean, _id: false,
    }],
    currency: { type: String, default: 'USD' },
    taxRatePct: { type: Number, default: 0 },
    taxLabel: String,
    discountType: { type: String, enum: ['none', 'percent', 'amount'], default: 'none' },
    discountValue: { type: Number, default: 0 },
    depositType: { type: String, enum: ['none', 'percent', 'amount'], default: 'none' },
    depositValue: { type: Number, default: 0 },
    totals: Schema.Types.Mixed,
    notes: String,
    terms: String,
    summary: String,
    accentColor: String,
    logoUrl: String,
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

/** An account-authored, reusable quote template (the "upload/save template" feature). */
const quoteTemplateSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, default: 'Custom' },
    terms: { type: String, default: '' },
    notes: String,
    defaultTaxRatePct: Number,
    accentColor: String,
    currency: String,
    lineItems: [{
      description: String, category: String, unit: String, quantity: Number, unitPrice: Number,
      discountPct: Number, taxable: Boolean, optional: Boolean, _id: false,
    }],
  },
  { timestamps: true },
);
quoteTemplateSchema.index({ accountId: 1, updatedAt: -1 });

/** Per-account quote settings: the managed category list + branding + defaults. */
const quoteSettingsSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, unique: true, index: true },
    categories: { type: [String], default: [] },
    accentColor: String,
    logoUrl: String,
    defaultCurrency: { type: String, default: 'USD' },
    defaultTaxRatePct: { type: Number, default: 0 },
    defaultValidDays: { type: Number, default: 30 },
    defaultTerms: { type: String, default: '' },
    defaultNotes: { type: String, default: '' },
  },
  { timestamps: true },
);

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

// ── AgentOps: evals, observability, approvals, self-correction ───────────────

/**
 * Observability trace — one durable record per run (call, agent run, assistant
 * command, content/property job). `spans` capture each LLM call, tool, judge and
 * retry with latency + estimated token cost. `input` is persisted so a failed
 * run can be replayed. Ephemeral live activity still flows through the event bus;
 * this is the queryable history behind the Observability dashboard.
 */
const traceSpanSub = new Schema(
  {
    id: String,
    name: String,
    type: { type: String, enum: ['llm', 'tool', 'agent', 'voice', 'outbound', 'judge', 'retry', 'compliance', 'http'], default: 'tool' },
    startedAt: String,
    durationMs: { type: Number, default: 0 },
    status: { type: String, enum: ['ok', 'error'], default: 'ok' },
    provider: String,
    model: String,
    tokensIn: Number,
    tokensOut: Number,
    costUsd: Number,
    error: String,
    meta: Schema.Types.Mixed,
  },
  { _id: false },
);

const traceSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    kind: { type: String, enum: ['call', 'agent-run', 'assistant', 'outbound', 'property-analysis', 'content', 'eval'], required: true, index: true },
    refId: { type: String, index: true },
    name: { type: String, required: true },
    status: { type: String, enum: ['running', 'ok', 'error'], default: 'running', index: true },
    startedAt: String,
    durationMs: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
    totalCostUsd: { type: Number, default: 0 },
    spans: { type: [traceSpanSub], default: [] },
    replayable: { type: Boolean, default: false },
    input: Schema.Types.Mixed,
    error: String,
  },
  { timestamps: true },
);
traceSchema.index({ accountId: 1, createdAt: -1 });

const criterionScoreSub = new Schema(
  { key: String, score: Number, reason: String },
  { _id: false },
);
const evalScoreValueSub = {
  overall: { type: Number, default: 0 },
  pass: { type: Boolean, default: false },
  criteria: { type: [criterionScoreSub], default: [] },
  verdict: String,
  judge: String,
};

/**
 * A single auto-score. `suite: 'production'` rows are live calls/decisions
 * scored automatically by the LLM-judge as they happen; 'capability'/'regression'
 * rows are produced by a suite run. Powers the score trend + self-correction.
 */
const evalScoreSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    suite: { type: String, enum: ['production', 'capability', 'regression'], default: 'production', index: true },
    target: { type: String, enum: ['call', 'assistant', 'outbound', 'agent-run'], required: true },
    refId: { type: String, index: true },
    agentKey: String,
    ...evalScoreValueSub,
    traceId: { type: Schema.Types.ObjectId, ref: 'Trace' },
    /** Self-correction bookkeeping. */
    corrected: { type: Boolean, default: false },
    correctionOf: { type: Schema.Types.ObjectId, ref: 'EvalScore' },
    attempt: { type: Number, default: 0 },
  },
  { timestamps: true },
);
evalScoreSchema.index({ accountId: 1, createdAt: -1 });
evalScoreSchema.index({ accountId: 1, suite: 1, createdAt: -1 });

/** A stored eval case (capability or regression). */
const evalCaseSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    suite: { type: String, enum: ['capability', 'regression'], required: true, index: true },
    target: { type: String, enum: ['call', 'assistant', 'outbound', 'agent-run'], required: true },
    name: { type: String, required: true },
    input: { type: String, required: true },
    context: Schema.Types.Mixed,
    assertions: { type: [{ type: { type: String }, value: String, label: String, _id: false }], default: [] },
    expectation: String,
    enabled: { type: Boolean, default: true },
  },
  { timestamps: true },
);
evalCaseSchema.index({ accountId: 1, suite: 1 });

/** One execution of a suite, with per-case results + aggregate. */
const evalRunSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    suite: { type: String, enum: ['capability', 'regression'], required: true },
    status: { type: String, enum: ['running', 'done', 'error'], default: 'running' },
    total: { type: Number, default: 0 },
    passed: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    passRate: { type: Number, default: 0 },
    avgScore: { type: Number, default: 0 },
    results: { type: [Schema.Types.Mixed], default: [] },
    triggeredBy: String,
    note: String,
    startedAt: String,
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true },
);
evalRunSchema.index({ accountId: 1, createdAt: -1 });

/**
 * A human-in-the-loop approval request. The agent persists the full `payload`
 * needed to resume, sets `status:'pending'`, and stops. When a human approves,
 * the matching executor replays `payload` — this is the durable-workflow resume
 * that lets an action wait minutes or hours and then continue exactly where it
 * paused.
 */
const approvalSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    action: { type: String, required: true, index: true },
    title: { type: String, required: true },
    summary: String,
    risk: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    payload: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['pending', 'approved', 'rejected', 'expired', 'executed', 'failed'], default: 'pending', index: true },
    requestedBy: String,
    decidedBy: String,
    reason: String,
    origin: String,
    leadId: { type: Schema.Types.ObjectId, ref: 'Lead' },
    result: Schema.Types.Mixed,
    expiresAt: Date,
    decidedAt: Date,
  },
  { timestamps: true },
);
approvalSchema.index({ accountId: 1, status: 1, createdAt: -1 });

/** Per-account AgentOps config: approval policy + self-correction settings. */
const agentOpsConfigSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, unique: true, index: true },
    approvalPolicy: { type: Schema.Types.Mixed, default: {} },
    selfCorrect: {
      enabled: { type: Boolean, default: true },
      threshold: { type: Number, default: 70 },
      maxAttempts: { type: Number, default: 1 },
    },
  },
  { timestamps: true },
);

function model<T extends Schema>(name: string, schema: T): Model<InferSchemaType<T>> {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}
export const PropertyAnalysis = model('PropertyAnalysis', propertyAnalysisSchema);
export const SiteConfig = model('SiteConfig', siteConfigSchema);
export const CmsContent = model('CmsContent', cmsContentSchema);
export const Quote = model('Quote', quoteSchema);
export const QuoteTemplateDoc = model('QuoteTemplate', quoteTemplateSchema);
export const QuoteSettings = model('QuoteSettings', quoteSettingsSchema);
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
export const MediaAsset = model('MediaAsset', mediaAssetSchema);
export const SocialConnection = model('SocialConnection', socialConnectionSchema);
export const AdCampaign = model('AdCampaign', adCampaignSchema);
export const AdResearch = model('AdResearch', adResearchSchema);
export const CompetitorAd = model('CompetitorAd', competitorAdSchema);
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

// AgentOps
export const Trace = model('Trace', traceSchema);
export const EvalScore = model('EvalScore', evalScoreSchema);
export const EvalCase = model('EvalCase', evalCaseSchema);
export const EvalRun = model('EvalRun', evalRunSchema);
export const Approval = model('Approval', approvalSchema);
export const AgentOpsConfig = model('AgentOpsConfig', agentOpsConfigSchema);
