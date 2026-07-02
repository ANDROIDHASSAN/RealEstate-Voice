import { z } from 'zod';
import { computeTotals, quoteLineItemSchema, type QuoteTotals } from './quotations.js';

/**
 * Owner Suite — the back-office modules a real-estate business runs on:
 * Invoicing & Payments, Deal Pipeline, Commission & Expense Ledger, and
 * Documents / E-sign. Types + Zod + pure math live here (shared, testable);
 * money is always recomputed server-side.
 */

// ===========================================================================
// Invoicing & Payments
// ===========================================================================

export const INVOICE_STATUSES = ['draft', 'sent', 'paid', 'partial', 'overdue', 'void'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoiceInputSchema = z.object({
  title: z.string().min(2).max(160),
  client: z.object({
    name: z.string().min(1).max(160),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().max(40).optional(),
    address: z.string().max(300).optional(),
  }),
  propertyAddress: z.string().max(300).optional(),
  quoteId: z.string().optional(),
  dealId: z.string().optional(),
  lineItems: z.array(quoteLineItemSchema).min(1).max(60),
  currency: z.enum(['USD', 'EUR', 'GBP', 'AED', 'SAR', 'BRL', 'MXN']).default('USD'),
  taxRatePct: z.number().min(0).max(100).default(0),
  discountType: z.enum(['none', 'percent', 'amount']).default('none'),
  discountValue: z.number().min(0).max(1_000_000_000).default(0),
  notes: z.string().max(4000).optional(),
  dueDays: z.number().min(0).max(365).default(14),
});
export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

export const recordPaymentSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  method: z.enum(['card', 'bank', 'cash', 'check', 'other']).default('other'),
  note: z.string().max(300).optional(),
});

/** Given totals + payments, derive the amount due and the settled status. */
export function invoiceBalance(totals: QuoteTotals, payments: { amount: number }[]): {
  paid: number;
  balance: number;
  status: InvoiceStatus;
} {
  const paid = Math.round(payments.reduce((s, p) => s + p.amount, 0) * 100) / 100;
  const balance = Math.round((totals.total - paid) * 100) / 100;
  const status: InvoiceStatus = paid <= 0 ? 'sent' : balance <= 0 ? 'paid' : 'partial';
  return { paid, balance: Math.max(0, balance), status };
}

export { computeTotals };

// ===========================================================================
// Deal Pipeline
// ===========================================================================

export const DEAL_STAGES = [
  'lead', 'appointment', 'offer', 'under-contract', 'closing', 'closed-won', 'closed-lost',
] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export const DEAL_STAGE_META: Record<DealStage, { label: string; tone: string }> = {
  lead: { label: 'Lead', tone: 'neutral' },
  appointment: { label: 'Appointment', tone: 'blue' },
  offer: { label: 'Offer Made', tone: 'purple' },
  'under-contract': { label: 'Under Contract', tone: 'yellow' },
  closing: { label: 'Closing', tone: 'blue' },
  'closed-won': { label: 'Closed — Won', tone: 'green' },
  'closed-lost': { label: 'Closed — Lost', tone: 'pink' },
};

export const dealTaskSchema = z.object({
  title: z.string().min(1).max(200),
  done: z.boolean().default(false),
  dueDate: z.string().optional(),
});

export const dealInputSchema = z.object({
  title: z.string().min(2).max(160),
  clientName: z.string().min(1).max(160),
  propertyAddress: z.string().max(300).optional(),
  side: z.enum(['buyer', 'seller', 'both']).default('buyer'),
  stage: z.enum(DEAL_STAGES).default('lead'),
  value: z.number().min(0).max(2_000_000_000).default(0),
  commissionPct: z.number().min(0).max(100).default(3),
  expectedCloseDate: z.string().optional(),
  leadId: z.string().optional(),
  notes: z.string().max(4000).optional(),
  tasks: z.array(dealTaskSchema).max(50).default([]),
});
export type DealInput = z.infer<typeof dealInputSchema>;

export const moveDealSchema = z.object({ stage: z.enum(DEAL_STAGES) });

/** Expected commission on a deal (gross, before splits). */
export function dealCommission(value: number, commissionPct: number): number {
  return Math.round(value * commissionPct) / 100;
}

/** Weighted pipeline value — probability by stage. */
export const STAGE_PROBABILITY: Record<DealStage, number> = {
  lead: 0.1, appointment: 0.25, offer: 0.5, 'under-contract': 0.8, closing: 0.95, 'closed-won': 1, 'closed-lost': 0,
};

// ===========================================================================
// Commission & Expense Ledger
// ===========================================================================

export const LEDGER_TYPES = ['income', 'expense'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const EXPENSE_CATEGORIES = ['marketing', 'transaction-fee', 'mileage', 'staging', 'signage', 'software', 'other'] as const;
export const INCOME_CATEGORIES = ['commission', 'referral', 'rental', 'consulting', 'other'] as const;

export const ledgerEntrySchema = z.object({
  type: z.enum(LEDGER_TYPES),
  category: z.string().min(1).max(60),
  description: z.string().max(300).optional(),
  amount: z.number().positive().max(1_000_000_000),
  date: z.string(),
  dealId: z.string().optional(),
});
export type LedgerEntryInput = z.infer<typeof ledgerEntrySchema>;

export interface LedgerSummary {
  totalIncome: number;
  totalExpense: number;
  net: number;
  byCategory: { category: string; type: LedgerType; amount: number }[];
  byMonth: { month: string; income: number; expense: number }[];
}

export function summarizeLedger(entries: { type: LedgerType; category: string; amount: number; date: string }[]): LedgerSummary {
  let totalIncome = 0;
  let totalExpense = 0;
  const cat = new Map<string, { type: LedgerType; amount: number }>();
  const mon = new Map<string, { income: number; expense: number }>();
  for (const e of entries) {
    if (e.type === 'income') totalIncome += e.amount;
    else totalExpense += e.amount;
    const ck = `${e.type}:${e.category}`;
    const c = cat.get(ck) ?? { type: e.type, amount: 0 };
    c.amount += e.amount;
    cat.set(ck, c);
    const mk = (e.date ?? '').slice(0, 7) || 'unknown';
    const m = mon.get(mk) ?? { income: 0, expense: 0 };
    if (e.type === 'income') m.income += e.amount;
    else m.expense += e.amount;
    mon.set(mk, m);
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    totalIncome: r2(totalIncome),
    totalExpense: r2(totalExpense),
    net: r2(totalIncome - totalExpense),
    byCategory: [...cat.entries()].map(([k, v]) => ({ category: k.split(':')[1]!, type: v.type, amount: r2(v.amount) })),
    byMonth: [...mon.entries()].sort().map(([month, v]) => ({ month, income: r2(v.income), expense: r2(v.expense) })),
  };
}

// ===========================================================================
// Documents & E-sign
// ===========================================================================

export const DOC_STATUSES = ['draft', 'sent', 'viewed', 'signed', 'declined'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export interface DocTemplate {
  key: string;
  name: string;
  category: 'listing' | 'buyer' | 'disclosure' | 'addendum';
  body: string;
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    key: 'listing-agreement',
    name: 'Exclusive Listing Agreement',
    category: 'listing',
    body: 'This Exclusive Right to Sell Listing Agreement is entered into between {{brokerage}} ("Broker") and {{client}} ("Seller") for the property at {{property}}.\n\n1. Term: The listing period begins on the date signed and continues for 180 days.\n2. Commission: Seller agrees to pay a commission of {{commission}}% of the final sale price at closing.\n3. Broker Duties: Broker will market the property, hold open houses, and present all offers.\n\nBy signing below, the parties agree to the terms above.',
  },
  {
    key: 'buyer-rep-agreement',
    name: 'Buyer Representation Agreement',
    category: 'buyer',
    body: 'This Buyer Representation Agreement is between {{brokerage}} ("Broker") and {{client}} ("Buyer").\n\n1. Broker agrees to represent Buyer in the purchase of real property.\n2. Term: 90 days from the date signed.\n3. Compensation: As set out in the accompanying proposal, payable at closing.\n\nBy signing, Buyer engages Broker as their exclusive representative.',
  },
  {
    key: 'sellers-disclosure',
    name: "Seller's Property Disclosure",
    category: 'disclosure',
    body: 'Property: {{property}}\nSeller: {{client}}\n\nThe Seller discloses the following known conditions of the property. Seller certifies the information is true and correct to the best of their knowledge.\n\n[ ] Roof condition\n[ ] Foundation / structural\n[ ] Plumbing / electrical\n[ ] Flooding / water intrusion\n[ ] HOA / assessments\n\nSigned by the Seller below.',
  },
  {
    key: 'price-addendum',
    name: 'Price Reduction Addendum',
    category: 'addendum',
    body: 'This addendum modifies the listing for {{property}}.\n\nThe list price is hereby changed to the amount agreed between {{brokerage}} and {{client}}. All other terms of the listing agreement remain in effect.\n\nSigned below.',
  },
];

export function docTemplate(key: string): DocTemplate | undefined {
  return DOC_TEMPLATES.find((t) => t.key === key);
}

export const documentInputSchema = z.object({
  title: z.string().min(2).max(160),
  templateKey: z.string().max(60).optional(),
  client: z.object({
    name: z.string().min(1).max(160),
    email: z.string().email().optional().or(z.literal('')),
  }),
  propertyAddress: z.string().max(300).optional(),
  body: z.string().min(1).max(20_000),
  dealId: z.string().optional(),
  leadId: z.string().optional(),
});
export type DocumentInput = z.infer<typeof documentInputSchema>;

export const signDocumentSchema = z.object({
  signerName: z.string().min(1).max(160),
  accept: z.boolean(),
});
