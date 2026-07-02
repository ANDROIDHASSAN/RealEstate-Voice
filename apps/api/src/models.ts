import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

const accountSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: String,
    timezone: { type: String, default: 'America/New_York' },
    locale: { type: String, enum: ['en', 'es', 'ar', 'pt', 'ht'], default: 'en' },
    plan: { type: String, enum: ['starter', 'pro', 'empire'], default: 'starter' },
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
    status: { type: String, enum: ['active', 'past_due', 'canceled'], default: 'active' },
  },
  { timestamps: true },
);

const userSchema = new Schema(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['owner', 'agent', 'admin'], default: 'owner' },
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

function model<T extends Schema>(name: string, schema: T): Model<InferSchemaType<T>> {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

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
export const IntegrationSetting = model('IntegrationSetting', integrationSettingSchema);
