import { z } from 'zod';

/**
 * Quotations & Proposals — owner-facing sales documents.
 *
 * An agent builds a branded quote/proposal (listing package, buyer
 * representation, closing-cost estimate, commission proposal, …) from a
 * template or from scratch, sends it, and tracks it through
 * draft → sent → viewed → accepted / declined / expired.
 *
 * Like the rest of the platform: types + Zod + the pure money math live here in
 * @truecode/shared (shared by web + api, unit-testable); totals are always
 * recomputed server-side so a tampered client can never change a price.
 */

// ---------------------------------------------------------------------------
// Line items & totals
// ---------------------------------------------------------------------------

export const quoteLineItemSchema = z.object({
  description: z.string().min(1).max(300),
  category: z.string().max(60).optional(),
  quantity: z.number().min(0).max(100_000).default(1),
  unitPrice: z.number().min(0).max(1_000_000_000),
});
export type QuoteLineItem = z.infer<typeof quoteLineItemSchema>;

export type DiscountType = 'none' | 'percent' | 'amount';

export interface QuoteTotals {
  subtotal: number;
  discountAmount: number;
  taxableBase: number;
  taxAmount: number;
  total: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Deterministic money math — the single source of truth for quote totals. */
export function computeTotals(
  lineItems: Pick<QuoteLineItem, 'quantity' | 'unitPrice'>[],
  opts: { taxRatePct?: number; discountType?: DiscountType; discountValue?: number } = {},
): QuoteTotals {
  const subtotal = round2(lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0));
  const discountType = opts.discountType ?? 'none';
  const discountValue = Math.max(0, opts.discountValue ?? 0);
  let discountAmount = 0;
  if (discountType === 'percent') discountAmount = round2(subtotal * Math.min(discountValue, 100) / 100);
  else if (discountType === 'amount') discountAmount = round2(Math.min(discountValue, subtotal));
  const taxableBase = round2(subtotal - discountAmount);
  const taxAmount = round2(taxableBase * Math.max(0, opts.taxRatePct ?? 0) / 100);
  const total = round2(taxableBase + taxAmount);
  return { subtotal, discountAmount, taxableBase, taxAmount, total };
}

// ---------------------------------------------------------------------------
// Commission calculator (bonus owner tool)
// ---------------------------------------------------------------------------

export interface CommissionBreakdown {
  salePrice: number;
  commissionPct: number;
  grossCommission: number;
  agentSplitPct: number;
  agentGross: number;
  brokerageGross: number;
  transactionFee: number;
  agentNet: number;
}

/** Estimate an agent's take-home from a sale. Pure, deterministic. */
export function commissionBreakdown(input: {
  salePrice: number;
  commissionPct: number;
  agentSplitPct?: number;
  transactionFee?: number;
}): CommissionBreakdown {
  const salePrice = Math.max(0, input.salePrice);
  const commissionPct = Math.max(0, input.commissionPct);
  const agentSplitPct = Math.min(100, Math.max(0, input.agentSplitPct ?? 70));
  const transactionFee = Math.max(0, input.transactionFee ?? 0);
  const grossCommission = round2(salePrice * commissionPct / 100);
  const agentGross = round2(grossCommission * agentSplitPct / 100);
  const brokerageGross = round2(grossCommission - agentGross);
  const agentNet = round2(Math.max(0, agentGross - transactionFee));
  return { salePrice, commissionPct, grossCommission, agentSplitPct, agentGross, brokerageGross, transactionFee, agentNet };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const QUOTE_STATUSES = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Create / update input
// ---------------------------------------------------------------------------

export const quoteInputSchema = z.object({
  title: z.string().min(2).max(160),
  client: z.object({
    name: z.string().min(1).max(160),
    email: z.string().email().optional().or(z.literal('')),
    phone: z.string().max(40).optional(),
    address: z.string().max(300).optional(),
  }),
  propertyAddress: z.string().max(300).optional(),
  leadId: z.string().optional(),
  lineItems: z.array(quoteLineItemSchema).min(1).max(60),
  currency: z.enum(['USD', 'EUR', 'GBP', 'AED', 'SAR', 'BRL', 'MXN']).default('USD'),
  taxRatePct: z.number().min(0).max(100).default(0),
  discountType: z.enum(['none', 'percent', 'amount']).default('none'),
  discountValue: z.number().min(0).max(1_000_000_000).default(0),
  notes: z.string().max(4000).optional(),
  terms: z.string().max(4000).optional(),
  validDays: z.number().min(1).max(365).default(30),
  templateKey: z.string().max(60).optional(),
});
export type QuoteInput = z.infer<typeof quoteInputSchema>;

export interface QuoteDTO extends Omit<QuoteInput, 'validDays'> {
  _id: string;
  accountId: string;
  number: string;
  status: QuoteStatus;
  totals: QuoteTotals;
  validUntil: string;
  sentAt?: string;
  viewedAt?: string;
  respondedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Real-estate service templates (config-driven, like the agent configs)
// ---------------------------------------------------------------------------

export interface QuoteTemplate {
  key: string;
  name: string;
  description: string;
  category: 'listing' | 'buyer' | 'estimate' | 'commission' | 'services';
  defaultTaxRatePct?: number;
  terms: string;
  lineItems: QuoteLineItem[];
}

export const QUOTE_TEMPLATES: QuoteTemplate[] = [
  {
    key: 'listing-premium',
    name: 'Premium Listing Package',
    description: 'Full-service marketing package to list and sell a home.',
    category: 'listing',
    terms: 'Fees are due at closing and deducted from seller proceeds. Marketing begins upon signed listing agreement.',
    lineItems: [
      { description: 'Professional HDR photography (25+ images)', category: 'Marketing', quantity: 1, unitPrice: 350 },
      { description: '3D virtual tour + floor plan', category: 'Marketing', quantity: 1, unitPrice: 300 },
      { description: 'Aerial drone photography & video', category: 'Marketing', quantity: 1, unitPrice: 275 },
      { description: 'Home staging consultation', category: 'Preparation', quantity: 1, unitPrice: 250 },
      { description: 'MLS listing + national syndication', category: 'Marketing', quantity: 1, unitPrice: 200 },
      { description: 'Social media ad campaign (30 days)', category: 'Marketing', quantity: 1, unitPrice: 500 },
      { description: 'Open house events', category: 'Marketing', quantity: 2, unitPrice: 150 },
    ],
  },
  {
    key: 'listing-standard',
    name: 'Standard Listing Package',
    description: 'Essential marketing to get a property sold.',
    category: 'listing',
    terms: 'Fees are due at closing. Package covers 90 days of active marketing.',
    lineItems: [
      { description: 'Professional photography (15 images)', category: 'Marketing', quantity: 1, unitPrice: 200 },
      { description: 'MLS listing + syndication', category: 'Marketing', quantity: 1, unitPrice: 150 },
      { description: 'Yard sign & lockbox', category: 'Preparation', quantity: 1, unitPrice: 75 },
      { description: 'Social media promotion', category: 'Marketing', quantity: 1, unitPrice: 250 },
    ],
  },
  {
    key: 'buyer-rep',
    name: 'Buyer Representation Proposal',
    description: 'Dedicated buyer-side representation and search services.',
    category: 'buyer',
    terms: 'Retainer credited toward closing. Buyer-broker compensation per representation agreement.',
    lineItems: [
      { description: 'Buyer consultation & needs analysis', category: 'Services', quantity: 1, unitPrice: 0 },
      { description: 'Curated property search & showings', category: 'Services', quantity: 1, unitPrice: 0 },
      { description: 'Comparative market analysis per offer', category: 'Services', quantity: 1, unitPrice: 0 },
      { description: 'Offer strategy & negotiation', category: 'Services', quantity: 1, unitPrice: 0 },
      { description: 'Transaction coordination to close', category: 'Services', quantity: 1, unitPrice: 0 },
    ],
  },
  {
    key: 'closing-estimate',
    name: 'Seller Closing Cost Estimate',
    description: 'Estimated costs a seller pays at closing.',
    category: 'estimate',
    terms: 'Estimates only — actual figures confirmed on the settlement statement.',
    lineItems: [
      { description: 'Title insurance (owner policy)', category: 'Closing', quantity: 1, unitPrice: 1200 },
      { description: 'Escrow / settlement fee', category: 'Closing', quantity: 1, unitPrice: 750 },
      { description: 'Recording & transfer fees', category: 'Closing', quantity: 1, unitPrice: 400 },
      { description: 'Home warranty (buyer credit)', category: 'Closing', quantity: 1, unitPrice: 550 },
      { description: 'Attorney / document prep', category: 'Closing', quantity: 1, unitPrice: 350 },
    ],
  },
  {
    key: 'commission-proposal',
    name: 'Commission Proposal',
    description: 'Transparent commission structure for a listing.',
    category: 'commission',
    terms: 'Commission is a percentage of the final sale price, payable at closing.',
    lineItems: [
      { description: 'Listing-side commission (of sale price)', category: 'Commission', quantity: 1, unitPrice: 15000 },
      { description: 'Buyer-agent cooperation (of sale price)', category: 'Commission', quantity: 1, unitPrice: 12500 },
    ],
  },
  {
    key: 'blank',
    name: 'Blank Quote',
    description: 'Start from scratch.',
    category: 'services',
    terms: 'This quote is valid for the period noted above.',
    lineItems: [{ description: 'Service', category: 'Services', quantity: 1, unitPrice: 0 }],
  },
];

export function quoteTemplate(key: string): QuoteTemplate | undefined {
  return QUOTE_TEMPLATES.find((t) => t.key === key);
}

export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SAR: 'SAR ', BRL: 'R$', MXN: 'MX$',
};

export function formatMoney(n: number, currency = 'USD'): string {
  const sym = CURRENCY_SYMBOL[currency] ?? '$';
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
