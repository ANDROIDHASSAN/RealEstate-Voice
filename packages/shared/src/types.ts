import type { ModuleFlag, PlanKey, UsageType } from './modules.js';

export type Locale = 'en' | 'es' | 'ar' | 'pt' | 'ht';
export const SUPPORTED_LOCALES: Locale[] = ['en', 'es', 'ar', 'pt', 'ht'];

export type Role = 'owner' | 'agent' | 'admin';

export type LeadSource =
  | 'zillow'
  | 'facebook'
  | 'website'
  | 'zapier'
  | 'instagram'
  | 'scrape'
  | 'manual'
  | 'other';

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'appointment'
  | 'nurture'
  | 'won'
  | 'lost'
  | 'dnc';

export type LeadIntent = 'buyer' | 'seller' | 'renter' | 'investor' | 'unknown';
export type Urgency = 'now' | '1-3mo' | '3-6mo' | '6mo+' | 'unknown';

export interface AccountDTO {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  timezone: string;
  locale: Locale;
  plan: PlanKey;
  enabledModules: ModuleFlag[];
  stripeCustomerId?: string;
  stripeSubId?: string;
  ghl?: { connected: boolean; locationId?: string };
  twilioNumber?: string;
  whatsappPhoneId?: string;
  status: 'active' | 'past_due' | 'canceled';
  createdAt: string;
}

export interface UserDTO {
  _id: string;
  accountId: string;
  name: string;
  email: string;
  role: Role;
}

export interface LeadDTO {
  _id: string;
  accountId: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
  locale: Locale;
  source: LeadSource;
  status: LeadStatus;
  intent: LeadIntent;
  urgency: Urgency;
  budget?: string;
  location?: string;
  propertyInterest?: string;
  score: number;
  assignedTo?: string;
  firstResponseSeconds?: number;
  ghlContactId?: string;
  consent: { sms: boolean; call: boolean; whatsapp: boolean; email: boolean };
  createdAt: string;
  lastContactedAt?: string;
}

export type CallOutcome =
  | 'booked'
  | 'qualified'
  | 'callback'
  | 'not-interested'
  | 'voicemail'
  | 'no-answer'
  | 'transferred'
  | 'failed';

export interface CallDTO {
  _id: string;
  accountId: string;
  leadId: string;
  direction: 'inbound' | 'outbound';
  provider: string;
  providerCallId?: string;
  agentKey: string;
  status: 'queued' | 'ringing' | 'in-progress' | 'completed' | 'failed' | 'blocked';
  durationSec: number;
  recordingUrl?: string;
  transcript?: { role: 'agent' | 'lead'; text: string; ts: number }[];
  summary?: string;
  outcome?: CallOutcome;
  bookedAppointmentId?: string;
  createdAt: string;
}

export interface AppointmentDTO {
  _id: string;
  accountId: string;
  leadId: string;
  startsAt: string;
  endsAt: string;
  type: 'showing' | 'listing-presentation' | 'buyer-consult' | 'call' | 'other';
  calendarEventId?: string;
  status: 'scheduled' | 'completed' | 'no-show' | 'canceled';
}

export type Channel = 'sms' | 'whatsapp' | 'email' | 'instagram';

export interface ConversationMessage {
  direction: 'inbound' | 'outbound';
  text: string;
  ts: string;
  status?: 'sent' | 'mock-sent' | 'delivered' | 'failed' | 'blocked';
  meta?: Record<string, unknown>;
}

export interface ConversationDTO {
  _id: string;
  accountId: string;
  leadId: string;
  channel: Channel;
  messages: ConversationMessage[];
  status: 'open' | 'ai' | 'human' | 'closed';
  lastInboundAt?: string;
}

export interface SequenceStep {
  delayHours: number;
  channel: Channel;
  template: string;
}

export interface SequenceDTO {
  _id: string;
  accountId: string;
  name: string;
  locale: Locale;
  steps: SequenceStep[];
}

export interface DripEnrollmentDTO {
  _id: string;
  accountId: string;
  leadId: string;
  sequenceId: string;
  currentStep: number;
  nextRunAt?: string;
  status: 'active' | 'paused' | 'completed' | 'stopped';
  history: { step: number; channel: Channel; sentAt: string; status: string }[];
}

export interface ContentPostDTO {
  _id: string;
  accountId: string;
  channel: 'instagram';
  type: 'post' | 'reel' | 'story';
  caption: string;
  mediaUrl?: string;
  scheduledAt: string;
  status: 'draft' | 'scheduled' | 'published' | 'stub-published' | 'failed';
}

export interface AgentRunDTO {
  _id: string;
  accountId: string;
  agentKey: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  nextAction?: { type: string; params: Record<string, unknown> };
  status: 'running' | 'done' | 'error';
  createdAt: string;
}

export interface UsageLedgerDTO {
  _id: string;
  accountId: string;
  type: UsageType;
  quantity: number;
  ts: string;
}

export interface ComplianceDTO {
  _id: string;
  accountId: string;
  dncList: string[];
  tcpaConsent: boolean;
  quietHours: { start: number; end: number }; // local hours, e.g. 8 & 21
}

export interface DashboardStats {
  speedToLeadP50: number | null;
  speedToLeadTrend: { date: string; seconds: number | null; leads: number }[];
  leadsThisWeek: number;
  callsBooked: number;
  pipeline: { status: LeadStatus; count: number }[];
  followupPerformance: { sent: number; replies: number };
  revenueMonthly: { month: string; amount: number }[];
}
