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
  /** Unit label shown after the qty (e.g. "hrs", "sqft", "mo"). Cosmetic. */
  unit: z.string().max(24).optional(),
  quantity: z.number().min(0).max(100_000).default(1),
  unitPrice: z.number().min(0).max(1_000_000_000),
  /** Per-line discount, 0–100 %. Applied before the quote-level discount. */
  discountPct: z.number().min(0).max(100).optional(),
  /** Whether tax applies to this line. Defaults to true (taxable). */
  taxable: z.boolean().optional(),
  /** Optional add-on the client can opt into — excluded from the running total. */
  optional: z.boolean().optional(),
});
export type QuoteLineItem = z.infer<typeof quoteLineItemSchema>;

export type DiscountType = 'none' | 'percent' | 'amount';
export type DepositType = 'none' | 'percent' | 'amount';

export interface QuoteTotals {
  subtotal: number;
  discountAmount: number;
  taxableBase: number;
  taxAmount: number;
  total: number;
  /** Up-front deposit required to start (0 when no deposit configured). */
  depositAmount: number;
  /** Remaining balance after the deposit (== total when no deposit). */
  balanceDue: number;
  /** Sum of optional add-ons not included in the total (informational). */
  optionalTotal: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

/** The net amount of a single line after its own per-line discount. */
export function lineNet(li: Pick<QuoteLineItem, 'quantity' | 'unitPrice' | 'discountPct'>): number {
  const gross = Math.max(0, li.quantity ?? 0) * Math.max(0, li.unitPrice ?? 0);
  const disc = li.discountPct ? gross * clampPct(li.discountPct) / 100 : 0;
  return round2(gross - disc);
}

type ComputableLine = Pick<QuoteLineItem, 'quantity' | 'unitPrice' | 'discountPct' | 'taxable' | 'optional'>;

/** Deterministic money math — the single source of truth for quote totals. */
export function computeTotals(
  lineItems: ComputableLine[],
  opts: {
    taxRatePct?: number;
    discountType?: DiscountType;
    discountValue?: number;
    depositType?: DepositType;
    depositValue?: number;
  } = {},
): QuoteTotals {
  // Optional add-ons never count toward the running total; they are surfaced
  // separately so the client sees what they'd cost if selected.
  const included = lineItems.filter((li) => !li.optional);
  const optionalTotal = round2(lineItems.filter((li) => li.optional).reduce((s, li) => s + lineNet(li), 0));

  const subtotal = round2(included.reduce((s, li) => s + lineNet(li), 0));
  const taxableSubtotal = round2(included.filter((li) => li.taxable !== false).reduce((s, li) => s + lineNet(li), 0));

  const discountType = opts.discountType ?? 'none';
  const discountValue = Math.max(0, opts.discountValue ?? 0);
  let discountAmount = 0;
  if (discountType === 'percent') discountAmount = round2(subtotal * Math.min(discountValue, 100) / 100);
  else if (discountType === 'amount') discountAmount = round2(Math.min(discountValue, subtotal));

  const taxableBase = round2(subtotal - discountAmount);
  // The quote-level discount is spread proportionally, so tax only lands on the
  // taxable share of the post-discount base. (All-taxable ⇒ taxableBase itself.)
  const taxableShare = subtotal > 0 ? taxableSubtotal / subtotal : 0;
  const taxableAfterDiscount = round2(taxableBase * taxableShare);
  const taxAmount = round2(taxableAfterDiscount * Math.max(0, opts.taxRatePct ?? 0) / 100);
  const total = round2(taxableBase + taxAmount);

  const depositType = opts.depositType ?? 'none';
  const depositValue = Math.max(0, opts.depositValue ?? 0);
  let depositAmount = 0;
  if (depositType === 'percent') depositAmount = round2(total * Math.min(depositValue, 100) / 100);
  else if (depositType === 'amount') depositAmount = round2(Math.min(depositValue, total));
  const balanceDue = round2(total - depositAmount);

  return { subtotal, discountAmount, taxableBase, taxAmount, total, depositAmount, balanceDue, optionalTotal };
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

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'BRL', 'MXN', 'INR', 'CAD', 'AUD'] as const;
export type Currency = (typeof CURRENCIES)[number];

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
    company: z.string().max(160).optional(),
  }),
  propertyAddress: z.string().max(300).optional(),
  leadId: z.string().optional(),
  lineItems: z.array(quoteLineItemSchema).min(1).max(120),
  currency: z.enum(CURRENCIES).default('USD'),
  taxRatePct: z.number().min(0).max(100).default(0),
  taxLabel: z.string().max(40).optional(),
  discountType: z.enum(['none', 'percent', 'amount']).default('none'),
  discountValue: z.number().min(0).max(1_000_000_000).default(0),
  depositType: z.enum(['none', 'percent', 'amount']).default('none'),
  depositValue: z.number().min(0).max(1_000_000_000).default(0),
  notes: z.string().max(4000).optional(),
  terms: z.string().max(8000).optional(),
  /** Optional cover/summary shown above the line items on the proposal. */
  summary: z.string().max(4000).optional(),
  validDays: z.number().min(1).max(365).default(30),
  templateKey: z.string().max(80).optional(),
  /** Brand accent (hex) applied to the PDF + client portal for this quote. */
  accentColor: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional(),
  logoUrl: z.string().url().max(500).optional().or(z.literal('')),
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
  publicToken?: string;
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
  /** Free-form grouping — built-ins use real-estate categories, custom any string. */
  category: string;
  /** True for account-authored templates (persisted); false/undefined for built-ins. */
  custom?: boolean;
  /** Present only on custom templates (their Mongo id). */
  _id?: string;
  defaultTaxRatePct?: number;
  accentColor?: string;
  currency?: Currency;
  notes?: string;
  terms: string;
  lineItems: QuoteLineItem[];
}

export const QUOTE_TEMPLATE_CATEGORIES = ['listing', 'buyer', 'estimate', 'commission', 'services'] as const;

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
      { description: 'Luxury print brochure & mailers', category: 'Marketing', quantity: 1, unitPrice: 400, optional: true },
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
    key: 'property-management',
    name: 'Property Management Agreement',
    description: 'Ongoing management fees for a rental property.',
    category: 'services',
    terms: 'Management fee billed monthly against collected rent. 30-day cancellation notice.',
    lineItems: [
      { description: 'Monthly management fee', category: 'Management', unit: 'mo', quantity: 12, unitPrice: 199 },
      { description: 'Tenant placement & screening', category: 'Leasing', quantity: 1, unitPrice: 750 },
      { description: 'Annual property inspection', category: 'Management', quantity: 1, unitPrice: 150 },
      { description: 'Maintenance coordination', category: 'Management', quantity: 1, unitPrice: 0 },
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

// ---------------------------------------------------------------------------
// Custom (account-authored) templates + account quote settings
// ---------------------------------------------------------------------------

/** Create/update payload for an account's own reusable template. */
export const customTemplateInputSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(300).default(''),
  category: z.string().min(1).max(60).default('Custom'),
  terms: z.string().max(8000).default(''),
  notes: z.string().max(4000).optional(),
  defaultTaxRatePct: z.number().min(0).max(100).optional(),
  accentColor: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional(),
  currency: z.enum(CURRENCIES).optional(),
  lineItems: z.array(quoteLineItemSchema).min(1).max(120),
});
export type CustomTemplateInput = z.infer<typeof customTemplateInputSchema>;

/** Account-level defaults + the managed category list that powers the builder. */
export const quoteSettingsSchema = z.object({
  categories: z.array(z.string().min(1).max(60)).max(80).default([]),
  accentColor: z.string().regex(/^#([0-9a-fA-F]{6})$/).optional(),
  logoUrl: z.string().url().max(500).optional().or(z.literal('')),
  defaultCurrency: z.enum(CURRENCIES).default('USD'),
  defaultTaxRatePct: z.number().min(0).max(100).default(0),
  defaultValidDays: z.number().min(1).max(365).default(30),
  defaultTerms: z.string().max(8000).default(''),
  defaultNotes: z.string().max(4000).default(''),
});
export type QuoteSettings = z.infer<typeof quoteSettingsSchema>;

export const DEFAULT_QUOTE_CATEGORIES = [
  'Marketing', 'Preparation', 'Photography', 'Staging', 'Services',
  'Closing', 'Commission', 'Management', 'Leasing', 'Consulting',
];

export const DEFAULT_QUOTE_SETTINGS: QuoteSettings = {
  categories: DEFAULT_QUOTE_CATEGORIES,
  defaultCurrency: 'USD',
  defaultTaxRatePct: 0,
  defaultValidDays: 30,
  defaultTerms: '',
  defaultNotes: '',
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const CURRENCY_SYMBOL: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SAR: 'SAR ', BRL: 'R$', MXN: 'MX$',
  INR: '₹', CAD: 'CA$', AUD: 'A$',
};

export function formatMoney(n: number, currency = 'USD'): string {
  const sym = CURRENCY_SYMBOL[currency] ?? '$';
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
