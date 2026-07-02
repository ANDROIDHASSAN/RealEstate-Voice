import { z } from 'zod';

/**
 * Property Intelligence — the multi-agent investment-analysis engine.
 *
 * Design contract (see CLAUDE.md):
 *  - All numbers here are REAL, deterministic calculations from the property
 *    inputs (cash flow, cap rate, ROI, fair value from comps, weighted score).
 *  - Where no external data source exists (comps, neighborhood, market), we use
 *    a deterministic model *seeded from the address* so a property always scores
 *    the same. These are labelled "modeled estimate" in the explainability layer,
 *    never presented as live MLS/records data.
 *  - LLM enrichment (executive summary, negotiation script, chat) lives in the
 *    API layer and always has a deterministic fallback — this module is pure and
 *    dependency-free so it is trivially unit-testable and shared by web + api.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export const PROPERTY_TYPES = [
  'single-family',
  'condo',
  'townhouse',
  'multi-family',
  'land',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export const propertyInputSchema = z.object({
  address: z.string().min(3).max(200),
  city: z.string().min(1).max(80),
  state: z.string().min(2).max(40),
  zip: z.string().min(3).max(12).optional().default(''),
  propertyType: z.enum(PROPERTY_TYPES).default('single-family'),
  askingPrice: z.number().positive().max(1_000_000_000),
  bedrooms: z.number().min(0).max(30).default(3),
  bathrooms: z.number().min(0).max(30).default(2),
  sqft: z.number().positive().max(1_000_000),
  yearBuilt: z.number().min(1800).max(2100).optional(),
  lotSizeSqft: z.number().min(0).max(50_000_000).optional(),
  // Optional overrides — when omitted the engine estimates them.
  estimatedRentMonthly: z.number().min(0).max(10_000_000).optional(),
  propertyTaxAnnual: z.number().min(0).max(100_000_000).optional(),
  hoaMonthly: z.number().min(0).max(1_000_000).optional(),
  repairCost: z.number().min(0).max(500_000_000).optional(),
  arv: z.number().min(0).max(2_000_000_000).optional(),
  // Financing assumptions.
  downPaymentPct: z.number().min(0).max(1).optional(),
  interestRatePct: z.number().min(0).max(30).optional(),
  loanTermYears: z.number().min(1).max(40).optional(),
  photoUrl: z.string().url().optional(),
  notes: z.string().max(2000).optional(),
});

export type PropertyInput = z.infer<typeof propertyInputSchema>;

// ---------------------------------------------------------------------------
// Grades & scoring helpers
// ---------------------------------------------------------------------------

export type LetterGrade = 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
export type Recommendation =
  | 'Strong Buy'
  | 'Buy'
  | 'Hold'
  | 'Negotiate'
  | 'Wait'
  | 'Avoid';
export type ScoreTier =
  | 'Elite Investment'
  | 'Strong Buy'
  | 'Buy'
  | 'Neutral'
  | 'Weak'
  | 'Avoid';
export type RiskLevel = 'Low' | 'Medium' | 'High';

export const AGENT_WEIGHTS = {
  comps: 0.25,
  rental: 0.2,
  neighborhood: 0.2,
  strategy: 0.2,
  market: 0.15,
} as const;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
const round = (n: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function letterGrade(score: number): LetterGrade {
  if (score >= 95) return 'A+';
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function scoreTier(score: number): ScoreTier {
  if (score >= 95) return 'Elite Investment';
  if (score >= 85) return 'Strong Buy';
  if (score >= 70) return 'Buy';
  if (score >= 55) return 'Neutral';
  if (score >= 40) return 'Weak';
  return 'Avoid';
}

export function riskLevel(riskScore: number): RiskLevel {
  if (riskScore >= 66) return 'High';
  if (riskScore >= 40) return 'Medium';
  return 'Low';
}

// ---------------------------------------------------------------------------
// Deterministic PRNG seeded from the property address (stable per property).
// ---------------------------------------------------------------------------

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded random helper — deterministic per property. */
function makeRng(input: PropertyInput): {
  next: () => number;
  between: (lo: number, hi: number) => number;
  int: (lo: number, hi: number) => number;
} {
  const seed = hashString(
    `${input.address}|${input.city}|${input.state}|${input.zip}|${input.sqft}`.toLowerCase(),
  );
  const next = mulberry32(seed);
  const between = (lo: number, hi: number) => lo + (hi - lo) * next();
  const int = (lo: number, hi: number) => Math.floor(between(lo, hi + 1));
  return { next, between, int };
}

// Coastal / disaster-exposed states raise the natural-disaster + insurance risk.
const COASTAL_STATES = new Set([
  'fl', 'florida', 'la', 'louisiana', 'tx', 'texas', 'sc', 'south carolina',
  'nc', 'north carolina', 'ca', 'california', 'ms', 'mississippi', 'al', 'alabama',
]);

// ---------------------------------------------------------------------------
// Financing math
// ---------------------------------------------------------------------------

function monthlyMortgage(principal: number, annualRatePct: number, years: number): number {
  const r = annualRatePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - (1 + r) ** -n);
}

// ---------------------------------------------------------------------------
// Explainability primitive — every conclusion carries its reasoning.
// ---------------------------------------------------------------------------

export interface Explanation {
  /** How confident the agent is in its own output (0–100). */
  confidence: number;
  /** Which inputs / data the conclusion is derived from. */
  dataUsed: string[];
  /** Human-readable reasoning. */
  reasoning: string;
  /** Whether the underlying data is a modeled estimate vs. a real input. */
  sources: string[];
}

// ---------------------------------------------------------------------------
// Agent result shapes
// ---------------------------------------------------------------------------

export interface Comparable {
  address: string;
  distanceMi: number;
  bedrooms: number;
  bathrooms: number;
  sqft: number;
  soldPrice: number;
  pricePerSqft: number;
  soldDaysAgo: number;
}

export interface CompsResult {
  score: number;
  fairValue: number;
  pricePerSqft: number;
  comps: Comparable[];
  priceDiff: number;
  priceDiffPct: number;
  verdict: 'Undervalued' | 'Fair' | 'Overpriced';
  explain: Explanation;
}

export interface CashFlow {
  monthlyRent: number;
  mortgage: number;
  propertyTax: number;
  insurance: number;
  hoa: number;
  maintenance: number;
  vacancy: number;
  management: number;
  netMonthly: number;
  annualNoi: number;
  capRatePct: number;
  cashOnCashPct: number;
  grm: number;
  dscr: number;
  breakEvenRent: number;
  cashInvested: number;
}

export interface RentalResult {
  score: number;
  grade: LetterGrade;
  cashFlow: CashFlow;
  rentalDemand: 'Low' | 'Moderate' | 'High' | 'Very High';
  occupancyPct: number;
  explain: Explanation;
}

export interface NeighborhoodResult {
  score: number;
  subScores: {
    schools: number;
    safety: number;
    walkability: number;
    transit: number;
    income: number;
    growth: number;
  };
  medianIncome: number;
  amenities: { parks: number; hospitals: number; restaurants: number; shopping: number; schools: number };
  pros: string[];
  cons: string[];
  growthPotential: 'Declining' | 'Stable' | 'Emerging' | 'Hot';
  explain: Explanation;
}

export type StrategyKey =
  | 'Buy & Hold'
  | 'BRRRR'
  | 'Fix & Flip'
  | 'Long-Term Rental'
  | 'Short-Term Rental'
  | 'House Hacking'
  | 'Commercial Conversion';

export interface StrategyResult {
  score: number;
  grade: LetterGrade;
  recommended: StrategyKey;
  alternatives: StrategyKey[];
  fiveYearRoiPct: number;
  tenYearRoiPct: number;
  expectedAppreciationPct: number;
  fiveYearEquity: number;
  explain: Explanation;
}

export interface MarketResult {
  score: number;
  grade: LetterGrade;
  trend: 'Cooling' | 'Flat' | 'Warming' | 'Hot';
  marketType: "Buyer's Market" | 'Balanced' | "Seller's Market";
  inventoryMonths: number;
  medianDom: number;
  priceTrendYoYPct: number;
  mortgageRatePct: number;
  forecast12moPct: number;
  explain: Explanation;
}

export interface RiskFactor {
  key: string;
  label: string;
  level: RiskLevel;
  note: string;
}

export interface RiskResult {
  score: number; // 0 (safe) – 100 (risky)
  level: RiskLevel;
  factors: RiskFactor[];
}

export interface Opportunity {
  key: string;
  label: string;
  detail: string;
}

export interface DealAnalysis {
  purchasePrice: number;
  closingCosts: number;
  repairCosts: number;
  arv: number;
  investmentRequired: number;
  projectedProfit: number;
  flipRoiPct: number;
  monthlyReturn: number;
}

export interface FairMarketValue {
  estimated: number;
  askingPrice: number;
  diff: number;
  diffPct: number;
  confidence: number;
  verdict: 'Undervalued' | 'Fair' | 'Overpriced';
}

export interface OfferGuidance {
  suggestedOffer: number;
  offerRangeLow: number;
  offerRangeHigh: number;
  walkAwayAbove: number;
}

/** The full orchestrated report — everything the UI + PDF render. */
export interface AnalysisReport {
  input: PropertyInput;
  investmentScore: number;
  grade: LetterGrade;
  tier: ScoreTier;
  recommendation: Recommendation;
  fairMarketValue: FairMarketValue;
  offer: OfferGuidance;
  agents: {
    comps: CompsResult;
    rental: RentalResult;
    neighborhood: NeighborhoodResult;
    strategy: StrategyResult;
    market: MarketResult;
  };
  weightedBreakdown: { key: keyof typeof AGENT_WEIGHTS; label: string; score: number; weight: number; contribution: number }[];
  risk: RiskResult;
  opportunities: Opportunity[];
  deal: DealAnalysis;
  /** Narrative sections — deterministic here, LLM-enriched in the API layer. */
  narrative: {
    executiveSummary: string;
    strengths: string[];
    weaknesses: string[];
    opportunities: string[];
    threats: string[];
    investmentOutlook: string;
    rentalOutlook: string;
    exitStrategy: string;
    finalRecommendation: string;
    negotiationScript: string;
    talkingPoints: string[];
  };
  /** ISO timestamp is stamped by the caller (engine is pure/deterministic). */
  modelVersion: string;
}

export const MODEL_VERSION = 'pi-1.0.0';

// ---------------------------------------------------------------------------
// Agent 1 — Comparable Sales (25%)
// ---------------------------------------------------------------------------

export function runCompsAgent(input: PropertyInput): CompsResult {
  const rng = makeRng(input);
  const subjectPpsf = input.askingPrice / input.sqft;
  // Model a cluster of recent comparable sales around the subject.
  const comps: Comparable[] = Array.from({ length: 5 }).map((_, i) => {
    const sqftVar = input.sqft * rng.between(0.85, 1.15);
    const ppsfVar = subjectPpsf * rng.between(0.88, 1.12);
    const soldPrice = round((sqftVar * ppsfVar) / 1000) * 1000;
    return {
      address: `${rng.int(100, 9999)} ${['Oak', 'Maple', 'Palm', 'Bay', 'Cedar', 'Sunset'][i % 6]} ${['St', 'Ave', 'Dr', 'Ln'][i % 4]}`,
      distanceMi: round(rng.between(0.2, 1.8), 1),
      bedrooms: clamp(input.bedrooms + rng.int(-1, 1), 0, 30),
      bathrooms: clamp(input.bathrooms + rng.int(-1, 1), 0, 30),
      sqft: round(sqftVar),
      soldPrice,
      pricePerSqft: round(soldPrice / sqftVar),
      soldDaysAgo: rng.int(15, 180),
    };
  });

  const ppsfValues = comps.map((c) => c.pricePerSqft).sort((a, b) => a - b);
  const medianPpsf = ppsfValues[Math.floor(ppsfValues.length / 2)]!;
  const fairValue = round((medianPpsf * input.sqft) / 1000) * 1000;
  const priceDiff = input.askingPrice - fairValue;
  const priceDiffPct = round((priceDiff / fairValue) * 100, 1);

  const verdict: CompsResult['verdict'] =
    priceDiffPct <= -3 ? 'Undervalued' : priceDiffPct >= 3 ? 'Overpriced' : 'Fair';

  // Underpriced ⇒ higher score. 10% under ≈ 85, 10% over ≈ 35.
  const score = round(clamp(60 - priceDiffPct * 2.5, 5, 98));

  // Confidence rises when the comp spread is tight.
  const spread = (ppsfValues[ppsfValues.length - 1]! - ppsfValues[0]!) / medianPpsf;
  const confidence = round(clamp(92 - spread * 120, 45, 95));

  return {
    score,
    fairValue,
    pricePerSqft: round(subjectPpsf),
    comps,
    priceDiff,
    priceDiffPct,
    verdict,
    explain: {
      confidence,
      dataUsed: ['asking price', 'square footage', '5 modeled comparable sales', 'median price/ft²'],
      reasoning: `Median comparable sold at $${medianPpsf}/ft²; applied to ${input.sqft.toLocaleString()} ft² yields a fair value of $${fairValue.toLocaleString()}. The asking price is ${Math.abs(priceDiffPct)}% ${priceDiff >= 0 ? 'above' : 'below'} that — ${verdict.toLowerCase()}.`,
      sources: ['modeled comparable set (seeded)'],
    },
  };
}

// ---------------------------------------------------------------------------
// Agent 2 — Rental Income (20%)
// ---------------------------------------------------------------------------

export function runRentalAgent(input: PropertyInput, fairValue: number): RentalResult {
  const rng = makeRng(input);
  const price = input.askingPrice;

  // Rent estimate: value-based, cheaper stock rents at a higher % of value.
  const band = price < 300_000 ? 0.0085 : price < 600_000 ? 0.0068 : price < 1_200_000 ? 0.0052 : 0.0038;
  const bedAdj = 1 + (input.bedrooms - 3) * 0.05;
  const monthlyRent = round(
    (input.estimatedRentMonthly ?? Math.max(500, fairValue * band * bedAdj)) / 25,
  ) * 25;

  const downPct = input.downPaymentPct ?? 0.2;
  const rate = input.interestRatePct ?? 7;
  const term = input.loanTermYears ?? 30;
  const loan = price * (1 - downPct);
  const mortgage = round(monthlyMortgage(loan, rate, term));

  const propertyTax = round((input.propertyTaxAnnual ?? price * 0.011) / 12);
  const insurance = round((price * 0.006) / 12);
  const hoa = round(input.hoaMonthly ?? 0);
  const maintenance = round(monthlyRent * 0.08);
  const vacancy = round(monthlyRent * 0.06);
  const management = round(monthlyRent * 0.08);

  const operatingExpenses = propertyTax + insurance + hoa + maintenance + vacancy + management;
  const netMonthly = round(monthlyRent - mortgage - operatingExpenses);
  const annualNoi = round((monthlyRent - operatingExpenses) * 12);
  const capRatePct = round((annualNoi / price) * 100, 2);

  const closing = price * 0.03;
  const repairs = input.repairCost ?? 0;
  const cashInvested = round(price * downPct + closing + repairs);
  const cashOnCashPct = round(((netMonthly * 12) / Math.max(1, cashInvested)) * 100, 2);
  const grm = round(price / Math.max(1, monthlyRent * 12), 1);
  const annualDebtService = mortgage * 12;
  const dscr = round(annualNoi / Math.max(1, annualDebtService), 2);
  const breakEvenRent = round(mortgage + operatingExpenses);

  const cashFlow: CashFlow = {
    monthlyRent, mortgage, propertyTax, insurance, hoa, maintenance, vacancy, management,
    netMonthly, annualNoi, capRatePct, cashOnCashPct, grm, dscr, breakEvenRent, cashInvested,
  };

  const score = round(
    clamp(30 + capRatePct * 6 + clamp(netMonthly / 20, -22, 22) + clamp(cashOnCashPct * 1.2, -6, 10), 5, 98),
  );
  const occupancyPct = round(clamp(88 + rng.between(0, 8), 85, 97));
  const rentalDemand: RentalResult['rentalDemand'] =
    occupancyPct >= 95 ? 'Very High' : occupancyPct >= 92 ? 'High' : occupancyPct >= 89 ? 'Moderate' : 'Low';

  return {
    score,
    grade: letterGrade(score),
    cashFlow,
    rentalDemand,
    occupancyPct,
    explain: {
      confidence: input.estimatedRentMonthly ? 88 : 70,
      dataUsed: ['estimated market rent', 'mortgage (P&I)', 'taxes/insurance/HOA', 'vacancy & management reserves'],
      reasoning: `At $${monthlyRent.toLocaleString()}/mo rent the property nets $${netMonthly.toLocaleString()}/mo after a $${mortgage.toLocaleString()} mortgage and operating reserves — a ${capRatePct}% cap rate and ${cashOnCashPct}% cash-on-cash return (DSCR ${dscr}).`,
      sources: [input.estimatedRentMonthly ? 'user-provided rent' : 'modeled rent estimate'],
    },
  };
}

// ---------------------------------------------------------------------------
// Agent 3 — Neighborhood Intelligence (20%)
// ---------------------------------------------------------------------------

export function runNeighborhoodAgent(input: PropertyInput): NeighborhoodResult {
  const rng = makeRng(input);
  const sub = {
    schools: round(rng.between(45, 96)),
    safety: round(rng.between(40, 95)),
    walkability: round(rng.between(30, 95)),
    transit: round(rng.between(25, 92)),
    income: round(rng.between(40, 95)),
    growth: round(rng.between(35, 96)),
  };
  const score = round(
    sub.schools * 0.25 +
      sub.safety * 0.2 +
      sub.walkability * 0.15 +
      sub.transit * 0.1 +
      sub.income * 0.15 +
      sub.growth * 0.15,
  );
  const medianIncome = round((30_000 + sub.income * 1400) / 1000) * 1000;
  const amenities = {
    parks: rng.int(2, 12),
    hospitals: rng.int(1, 6),
    restaurants: rng.int(8, 80),
    shopping: rng.int(3, 30),
    schools: rng.int(3, 18),
  };

  const labels: Record<keyof typeof sub, string> = {
    schools: 'Strong school ratings',
    safety: 'Low crime / high safety',
    walkability: 'Highly walkable',
    transit: 'Good transit access',
    income: 'Affluent, stable incomes',
    growth: 'Strong growth trajectory',
  };
  const pros: string[] = [];
  const cons: string[] = [];
  (Object.keys(sub) as (keyof typeof sub)[]).forEach((k) => {
    if (sub[k] >= 75) pros.push(labels[k]);
    else if (sub[k] < 50) cons.push(labels[k].replace('Strong', 'Weak').replace('Low crime / high safety', 'Elevated crime').replace('Highly walkable', 'Car-dependent').replace('Good transit access', 'Limited transit').replace('Affluent, stable incomes', 'Below-median incomes').replace('Strong growth trajectory', 'Flat growth'));
  });
  if (pros.length === 0) pros.push('Balanced, no major weaknesses');

  const growthPotential: NeighborhoodResult['growthPotential'] =
    sub.growth >= 85 ? 'Hot' : sub.growth >= 68 ? 'Emerging' : sub.growth >= 48 ? 'Stable' : 'Declining';

  return {
    score,
    subScores: sub,
    medianIncome,
    amenities,
    pros,
    cons,
    growthPotential,
    explain: {
      confidence: 68,
      dataUsed: ['school ratings', 'crime/safety index', 'walk & transit scores', 'median income', 'growth signals'],
      reasoning: `Neighborhood scores ${score}/100 — led by ${pros[0]?.toLowerCase() ?? 'balanced fundamentals'}. Median income ~$${medianIncome.toLocaleString()}, growth outlook: ${growthPotential}.`,
      sources: ['modeled neighborhood index (seeded)'],
    },
  };
}

// ---------------------------------------------------------------------------
// Agent 4 — Investment Strategy (20%)
// ---------------------------------------------------------------------------

export function runStrategyAgent(
  input: PropertyInput,
  rental: RentalResult,
  neighborhood: NeighborhoodResult,
): StrategyResult {
  const expectedAppreciationPct = round(1.5 + (neighborhood.subScores.growth / 100) * 5, 1);
  const cf = rental.cashFlow;

  // Pick the best-fit strategy from the fundamentals.
  let recommended: StrategyKey;
  const alternatives: StrategyKey[] = [];
  if ((input.repairCost ?? 0) > 0 && (input.arv ?? 0) > input.askingPrice * 1.15) {
    recommended = 'Fix & Flip';
    alternatives.push('BRRRR', 'Buy & Hold');
  } else if (cf.capRatePct >= 6 && cf.netMonthly > 150) {
    recommended = 'Long-Term Rental';
    alternatives.push('Buy & Hold', 'House Hacking');
  } else if (neighborhood.subScores.walkability >= 75 && neighborhood.subScores.growth >= 70) {
    recommended = 'Short-Term Rental';
    alternatives.push('Long-Term Rental', 'Buy & Hold');
  } else if (input.propertyType === 'multi-family') {
    recommended = 'House Hacking';
    alternatives.push('Buy & Hold', 'Long-Term Rental');
  } else if (expectedAppreciationPct >= 5) {
    recommended = 'Buy & Hold';
    alternatives.push('Long-Term Rental', 'BRRRR');
  } else {
    recommended = 'Buy & Hold';
    alternatives.push('Long-Term Rental');
  }

  // 5/10yr ROI = appreciation on value + accumulated cash flow + rough equity paydown, over cash invested.
  const price = input.askingPrice;
  const project = (years: number): number => {
    const appreciation = price * ((1 + expectedAppreciationPct / 100) ** years - 1);
    const cumulativeCashFlow = cf.netMonthly * 12 * years;
    const equityPaydown = price * (1 - (input.downPaymentPct ?? 0.2)) * 0.02 * years;
    return round(((appreciation + cumulativeCashFlow + equityPaydown) / Math.max(1, cf.cashInvested)) * 100);
  };
  const fiveYearRoiPct = project(5);
  const tenYearRoiPct = project(10);
  const fiveYearEquity = round(
    price * ((1 + expectedAppreciationPct / 100) ** 5 - 1) + price * (1 - (input.downPaymentPct ?? 0.2)) * 0.02 * 5,
  );

  const score = round(
    clamp(
      35 + expectedAppreciationPct * 5 + rental.score * 0.3 + neighborhood.subScores.growth * 0.15,
      5,
      98,
    ),
  );

  return {
    score,
    grade: letterGrade(score),
    recommended,
    alternatives,
    fiveYearRoiPct,
    tenYearRoiPct,
    expectedAppreciationPct,
    fiveYearEquity,
    explain: {
      confidence: 72,
      dataUsed: ['cash flow & cap rate', 'appreciation outlook', 'neighborhood growth', 'property type'],
      reasoning: `Best-fit strategy is ${recommended} — projecting ${expectedAppreciationPct}%/yr appreciation, a ${fiveYearRoiPct}% 5-year and ${tenYearRoiPct}% 10-year total ROI on $${cf.cashInvested.toLocaleString()} invested.`,
      sources: ['engine projection'],
    },
  };
}

// ---------------------------------------------------------------------------
// Agent 5 — Market Trend (15%)
// ---------------------------------------------------------------------------

export function runMarketAgent(input: PropertyInput): MarketResult {
  const rng = makeRng(input);
  const inventoryMonths = round(rng.between(1.2, 8.5), 1);
  const medianDom = round(rng.between(12, 95));
  const priceTrendYoYPct = round(rng.between(-6, 14), 1);
  const mortgageRatePct = round(input.interestRatePct ?? rng.between(6.2, 7.6), 2);
  const forecast12moPct = round(priceTrendYoYPct * 0.6 + rng.between(-2, 3), 1);

  const marketType: MarketResult['marketType'] =
    inventoryMonths <= 3 ? "Seller's Market" : inventoryMonths <= 6 ? 'Balanced' : "Buyer's Market";
  const trend: MarketResult['trend'] =
    priceTrendYoYPct >= 8 ? 'Hot' : priceTrendYoYPct >= 3 ? 'Warming' : priceTrendYoYPct >= -1 ? 'Flat' : 'Cooling';

  // A buyer's market with cooling prices is *good* for an acquiring investor.
  const score = round(
    clamp(
      50 +
        (inventoryMonths > 6 ? 12 : inventoryMonths < 3 ? -8 : 0) +
        forecast12moPct * 3 +
        (medianDom > 60 ? 8 : medianDom < 25 ? -6 : 0) +
        (mortgageRatePct < 6.8 ? 6 : mortgageRatePct > 7.5 ? -6 : 0),
      5,
      98,
    ),
  );

  return {
    score,
    grade: letterGrade(score),
    trend,
    marketType,
    inventoryMonths,
    medianDom,
    priceTrendYoYPct,
    mortgageRatePct,
    forecast12moPct,
    explain: {
      confidence: 65,
      dataUsed: ['months of inventory', 'median days-on-market', 'YoY price trend', 'mortgage rates'],
      reasoning: `${marketType} with ${inventoryMonths} months of inventory and ${medianDom}-day median DOM. Prices ${priceTrendYoYPct >= 0 ? 'up' : 'down'} ${Math.abs(priceTrendYoYPct)}% YoY; 12-month forecast ${forecast12moPct >= 0 ? '+' : ''}${forecast12moPct}%.`,
      sources: ['modeled market index (seeded)'],
    },
  };
}

// ---------------------------------------------------------------------------
// Risk analysis
// ---------------------------------------------------------------------------

export function assessRisk(
  input: PropertyInput,
  neighborhood: NeighborhoodResult,
  market: MarketResult,
  rental: RentalResult,
): RiskResult {
  const rng = makeRng(input);
  const age = input.yearBuilt ? new Date().getUTCFullYear() - input.yearBuilt : 30;
  const coastal = COASTAL_STATES.has(input.state.trim().toLowerCase());
  const floodBase = coastal ? rng.between(45, 85) : rng.between(5, 40);

  const lvl = (v: number): RiskLevel => (v >= 66 ? 'High' : v >= 40 ? 'Medium' : 'Low');
  const raw: { key: string; label: string; value: number; note: string }[] = [
    { key: 'crime', label: 'Crime', value: round(100 - neighborhood.subScores.safety), note: `Safety index ${neighborhood.subScores.safety}/100` },
    { key: 'flood', label: 'Flood / Natural Disaster', value: round(floodBase), note: coastal ? `${input.state} — coastal / storm exposure` : 'Inland — low disaster exposure' },
    { key: 'insurance', label: 'Insurance Cost', value: round(coastal ? floodBase * 0.9 : 25 + age * 0.5), note: coastal ? 'Elevated premiums in coastal zones' : 'Standard premium region' },
    { key: 'roof', label: 'Roof / Foundation Age', value: round(clamp(age * 2.2, 5, 92)), note: input.yearBuilt ? `Built ${input.yearBuilt} (~${age} yrs)` : 'Year built unknown — inspect' },
    { key: 'vacancy', label: 'Vacancy', value: round(100 - rental.occupancyPct + 10), note: `Modeled occupancy ${rental.occupancyPct}%` },
    { key: 'supply', label: 'Future Supply', value: round(clamp(market.inventoryMonths * 10, 10, 90)), note: `${market.inventoryMonths} months of inventory` },
    { key: 'market', label: 'Market Slowdown', value: round(clamp(50 - market.priceTrendYoYPct * 4, 5, 95)), note: `Prices ${market.priceTrendYoYPct >= 0 ? '+' : ''}${market.priceTrendYoYPct}% YoY` },
    { key: 'economic', label: 'Economic / Income', value: round(100 - neighborhood.subScores.income), note: `Area income index ${neighborhood.subScores.income}/100` },
  ];

  const factors: RiskFactor[] = raw.map((r) => ({ key: r.key, label: r.label, level: lvl(r.value), note: r.note }));
  const score = round(raw.reduce((s, r) => s + r.value, 0) / raw.length);
  return { score, level: riskLevel(score), factors };
}

// ---------------------------------------------------------------------------
// Opportunity detection
// ---------------------------------------------------------------------------

export function detectOpportunities(
  input: PropertyInput,
  comps: CompsResult,
  rental: RentalResult,
  neighborhood: NeighborhoodResult,
  strategy: StrategyResult,
): Opportunity[] {
  const ops: Opportunity[] = [];
  if (comps.verdict === 'Undervalued')
    ops.push({ key: 'undervalued', label: 'Undervalued Deal', detail: `Priced ${Math.abs(comps.priceDiffPct)}% below modeled fair value — instant equity on acquisition.` });
  if (rental.cashFlow.capRatePct >= 6)
    ops.push({ key: 'cashflow', label: 'Cash-Flow Opportunity', detail: `${rental.cashFlow.capRatePct}% cap rate clears the 6% cash-flow threshold.` });
  if (neighborhood.growthPotential === 'Emerging' || neighborhood.growthPotential === 'Hot')
    ops.push({ key: 'appreciation', label: 'Appreciation / Emerging Area', detail: `${neighborhood.growthPotential} submarket — above-average appreciation runway.` });
  if ((input.repairCost ?? 0) > 0)
    ops.push({ key: 'valueadd', label: 'Value-Add / Renovation', detail: 'Budgeted rehab creates forced appreciation and refinance upside (BRRRR).' });
  if (strategy.recommended === 'Short-Term Rental')
    ops.push({ key: 'arbitrage', label: 'Rental Arbitrage (STR)', detail: 'Walkable, high-growth location supports premium short-term nightly rates.' });
  if (rental.cashFlow.netMonthly > 0)
    ops.push({ key: 'tax', label: 'Tax Benefits', detail: 'Depreciation + mortgage-interest deductions can shelter the cash flow.' });
  if (ops.length === 0)
    ops.push({ key: 'stable', label: 'Stable Hold', detail: 'No standout edge, but fundamentals support a conservative long-term hold.' });
  return ops;
}

// ---------------------------------------------------------------------------
// Deal analyzer (flip lens)
// ---------------------------------------------------------------------------

export function analyzeDeal(input: PropertyInput, fairValue: number): DealAnalysis {
  const purchasePrice = input.askingPrice;
  const closingCosts = round(purchasePrice * 0.03);
  const repairCosts = input.repairCost ?? 0;
  const arv = input.arv ?? round(Math.max(fairValue, purchasePrice) * 1.08);
  const sellingCosts = round(arv * 0.07);
  const investmentRequired = round(purchasePrice + closingCosts + repairCosts);
  const projectedProfit = round(arv - investmentRequired - sellingCosts);
  const flipRoiPct = round((projectedProfit / Math.max(1, investmentRequired)) * 100, 1);
  const monthlyReturn = round(projectedProfit / 6); // ~6-month flip horizon
  return { purchasePrice, closingCosts, repairCosts, arv, investmentRequired, projectedProfit, flipRoiPct, monthlyReturn };
}

// ---------------------------------------------------------------------------
// Orchestrator — weighted aggregation + recommendation + narrative
// ---------------------------------------------------------------------------

function recommendationFor(score: number, comps: CompsResult, risk: RiskResult): Recommendation {
  if (score >= 85) return 'Strong Buy';
  if (score < 40 || risk.level === 'High') return score < 40 ? 'Avoid' : 'Negotiate';
  if (comps.verdict === 'Overpriced' && score < 70) return 'Negotiate';
  if (score >= 70) return 'Buy';
  if (score >= 55) return 'Hold';
  return 'Wait';
}

export function orchestrate(input: PropertyInput): AnalysisReport {
  const comps = runCompsAgent(input);
  const rental = runRentalAgent(input, comps.fairValue);
  const neighborhood = runNeighborhoodAgent(input);
  const strategy = runStrategyAgent(input, rental, neighborhood);
  const market = runMarketAgent(input);

  const weightedBreakdown = [
    { key: 'comps' as const, label: 'Comparable Sales', score: comps.score, weight: AGENT_WEIGHTS.comps },
    { key: 'rental' as const, label: 'Rental Income', score: rental.score, weight: AGENT_WEIGHTS.rental },
    { key: 'neighborhood' as const, label: 'Neighborhood', score: neighborhood.score, weight: AGENT_WEIGHTS.neighborhood },
    { key: 'strategy' as const, label: 'Investment Strategy', score: strategy.score, weight: AGENT_WEIGHTS.strategy },
    { key: 'market' as const, label: 'Market Trend', score: market.score, weight: AGENT_WEIGHTS.market },
  ].map((b) => ({ ...b, contribution: round(b.score * b.weight, 1) }));

  const investmentScore = round(clamp(weightedBreakdown.reduce((s, b) => s + b.contribution, 0), 0, 100));
  const risk = assessRisk(input, neighborhood, market, rental);
  const opportunities = detectOpportunities(input, comps, rental, neighborhood, strategy);
  const deal = analyzeDeal(input, comps.fairValue);
  const recommendation = recommendationFor(investmentScore, comps, risk);

  const fairMarketValue: FairMarketValue = {
    estimated: comps.fairValue,
    askingPrice: input.askingPrice,
    diff: comps.priceDiff,
    diffPct: comps.priceDiffPct,
    confidence: comps.explain.confidence,
    verdict: comps.verdict,
  };

  // Suggested offer: anchor below fair value, wider when the market favors buyers.
  const marketDiscount = market.marketType === "Buyer's Market" ? 0.05 : market.marketType === 'Balanced' ? 0.03 : 0.01;
  const suggestedOffer = round((comps.fairValue * (1 - marketDiscount)) / 1000) * 1000;
  const offer: OfferGuidance = {
    suggestedOffer,
    offerRangeLow: round((suggestedOffer * 0.97) / 1000) * 1000,
    offerRangeHigh: round((comps.fairValue * (1 + 0.005)) / 1000) * 1000,
    walkAwayAbove: round((comps.fairValue * 1.03) / 1000) * 1000,
  };

  const narrative = buildNarrative({
    input, investmentScore, recommendation, comps, rental, neighborhood, strategy, market, risk, opportunities, offer, fairMarketValue,
  });

  return {
    input,
    investmentScore,
    grade: letterGrade(investmentScore),
    tier: scoreTier(investmentScore),
    recommendation,
    fairMarketValue,
    offer,
    agents: { comps, rental, neighborhood, strategy, market },
    weightedBreakdown,
    risk,
    opportunities,
    deal,
    narrative,
    modelVersion: MODEL_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Deterministic narrative (LLM enrichment overrides these in the API layer)
// ---------------------------------------------------------------------------

function money(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

function buildNarrative(ctx: {
  input: PropertyInput;
  investmentScore: number;
  recommendation: Recommendation;
  comps: CompsResult;
  rental: RentalResult;
  neighborhood: NeighborhoodResult;
  strategy: StrategyResult;
  market: MarketResult;
  risk: RiskResult;
  opportunities: Opportunity[];
  offer: OfferGuidance;
  fairMarketValue: FairMarketValue;
}): AnalysisReport['narrative'] {
  const { input, investmentScore, recommendation, comps, rental, neighborhood, strategy, market, risk, opportunities, offer, fairMarketValue } = ctx;
  const tier = scoreTier(investmentScore);

  const executiveSummary =
    `${input.address}, ${input.city} scores ${investmentScore}/100 (${letterGrade(investmentScore)} — ${tier}). ` +
    `Asking ${money(input.askingPrice)} against a modeled fair value of ${money(fairMarketValue.estimated)} (${fairMarketValue.verdict.toLowerCase()}, ${Math.abs(fairMarketValue.diffPct)}% ${fairMarketValue.diff >= 0 ? 'above' : 'below'}). ` +
    `As a ${strategy.recommended} it projects a ${strategy.fiveYearRoiPct}% 5-year ROI with ${rental.cashFlow.capRatePct}% cap rate and ${money(rental.cashFlow.netMonthly)}/mo cash flow. Overall risk is ${risk.level.toLowerCase()}. Recommendation: ${recommendation}.`;

  const strengths: string[] = [];
  if (comps.verdict === 'Undervalued') strengths.push(`Priced ${Math.abs(comps.priceDiffPct)}% below fair value`);
  if (rental.cashFlow.netMonthly > 150) strengths.push(`Positive ${money(rental.cashFlow.netMonthly)}/mo cash flow`);
  if (neighborhood.score >= 70) strengths.push(`Strong neighborhood (${neighborhood.score}/100)`);
  if (strategy.expectedAppreciationPct >= 4) strengths.push(`${strategy.expectedAppreciationPct}%/yr appreciation outlook`);
  if (market.marketType === "Buyer's Market") strengths.push('Buyer-favorable market — negotiating leverage');
  if (strengths.length === 0) strengths.push('Balanced fundamentals with no critical weakness');

  const weaknesses: string[] = [];
  if (comps.verdict === 'Overpriced') weaknesses.push(`Asking ${comps.priceDiffPct}% above fair value`);
  if (rental.cashFlow.netMonthly <= 0) weaknesses.push('Negative or break-even cash flow at list price');
  if (neighborhood.score < 55) weaknesses.push(`Weaker neighborhood profile (${neighborhood.score}/100)`);
  risk.factors.filter((f) => f.level === 'High').forEach((f) => weaknesses.push(`High ${f.label.toLowerCase()} risk`));
  if (weaknesses.length === 0) weaknesses.push('No material weaknesses detected');

  const finalRecommendation =
    recommendation === 'Strong Buy'
      ? `Move fast. Offer at or near ${money(offer.suggestedOffer)}; this is a top-decile deal.`
      : recommendation === 'Buy'
        ? `A solid acquisition. Open at ${money(offer.offerRangeLow)}–${money(offer.offerRangeHigh)} and hold firm above ${money(offer.walkAwayAbove)}.`
        : recommendation === 'Negotiate'
          ? `Only viable with a price cut. Anchor at ${money(offer.offerRangeLow)} and walk away above ${money(offer.walkAwayAbove)}.`
          : recommendation === 'Hold'
            ? `Marginal at list. Revisit if the seller drops below ${money(offer.suggestedOffer)}.`
            : recommendation === 'Wait'
              ? `Fundamentals are soft — monitor for 30 days and re-run before committing.`
              : `Pass. The risk-adjusted return does not justify the price.`;

  const negotiationScript =
    `"We're serious buyers and we've done our homework on ${input.address}. Comparable sales support a value near ${money(fairMarketValue.estimated)}, ` +
    `and at a ${market.medianDom}-day median days-on-market in a ${market.marketType.toLowerCase()}, we're prepared to close cleanly at ${money(offer.suggestedOffer)}. ` +
    `${risk.factors.find((f) => f.level === 'High') ? `We're also factoring in ${risk.factors.find((f) => f.level === 'High')!.label.toLowerCase()}, which affects our carrying costs. ` : ''}` +
    `That's a strong, financeable offer today — can we make it work?"`;

  const talkingPoints = [
    `Fair value ${money(fairMarketValue.estimated)} vs. asking ${money(input.askingPrice)} (${fairMarketValue.verdict})`,
    `${market.marketType} · ${market.medianDom}-day median DOM · ${market.inventoryMonths} mo inventory`,
    `Cash flow ${money(rental.cashFlow.netMonthly)}/mo · ${rental.cashFlow.capRatePct}% cap rate`,
    ...(risk.factors.filter((f) => f.level === 'High').slice(0, 2).map((f) => `Leverage: ${f.label.toLowerCase()} risk justifies a lower offer`)),
  ];

  return {
    executiveSummary,
    strengths,
    weaknesses,
    opportunities: opportunities.map((o) => `${o.label}: ${o.detail}`),
    threats: risk.factors.filter((f) => f.level !== 'Low').map((f) => `${f.label} (${f.level}): ${f.note}`),
    investmentOutlook: `${strategy.recommended} projects ${strategy.fiveYearRoiPct}% (5yr) / ${strategy.tenYearRoiPct}% (10yr) total ROI on ${money(rental.cashFlow.cashInvested)} invested, driven by ${strategy.expectedAppreciationPct}%/yr appreciation and ${money(rental.cashFlow.netMonthly)}/mo cash flow.`,
    rentalOutlook: `${rental.rentalDemand} rental demand at ${rental.occupancyPct}% occupancy. Market rent ~${money(rental.cashFlow.monthlyRent)}/mo, break-even at ${money(rental.cashFlow.breakEvenRent)}/mo, DSCR ${rental.cashFlow.dscr}.`,
    exitStrategy:
      strategy.recommended === 'Fix & Flip'
        ? 'Primary: renovate and resell within 6–9 months. Backup: refinance and hold as a rental if the market softens.'
        : 'Primary: hold 5–10 years for appreciation + cash flow, then 1031-exchange into a larger asset. Backup: sell into the next seller\'s market.',
    finalRecommendation,
    negotiationScript,
    talkingPoints,
  };
}
