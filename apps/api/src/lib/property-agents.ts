import { getLLM } from '@truecode/integrations';
import { orchestrate, type AnalysisReport, type PropertyInput } from '@truecode/shared';
import { logger } from '../logger.js';

/**
 * Property Intelligence — API-side orchestration.
 *
 * The heavy lifting (5 agents + weighted scoring + all financial math) is the
 * pure, deterministic engine in @truecode/shared. Here we add the optional LLM
 * layer: it rewrites the *narrative* (executive summary, SWOT, negotiation
 * script) in a sharper analyst voice when a key is configured, and always falls
 * back to the deterministic narrative (mock mode / any failure). Numbers are
 * never touched by the LLM — only prose.
 */

export interface EnrichResult {
  report: AnalysisReport;
  enriched: boolean;
}

const SYSTEM = [
  'You are a senior real-estate investment analyst writing for a Bloomberg-Terminal-style report.',
  'You are given a computed analysis (scores, cash flow, comps, risk). NEVER change any number.',
  'Rewrite ONLY the narrative prose: crisp, confident, specific, no hedging, no fluff.',
  'Return STRICT JSON matching the requested shape. No markdown, no commentary.',
].join(' ');

export async function orchestrateAndEnrich(input: PropertyInput): Promise<EnrichResult> {
  const report = orchestrate(input);
  const llm = getLLM();
  if (!llm.info.live) return { report, enriched: false };

  const prompt = [
    'COMPUTED ANALYSIS (authoritative — do not alter numbers):',
    JSON.stringify({
      score: report.investmentScore,
      grade: report.grade,
      recommendation: report.recommendation,
      fairValue: report.fairMarketValue,
      offer: report.offer,
      cashFlow: report.agents.rental.cashFlow,
      capRate: report.agents.rental.cashFlow.capRatePct,
      strategy: report.agents.strategy,
      neighborhood: { score: report.agents.neighborhood.score, growth: report.agents.neighborhood.growthPotential, pros: report.agents.neighborhood.pros, cons: report.agents.neighborhood.cons },
      market: report.agents.market,
      risk: report.risk,
      property: report.input,
    }),
    '',
    'Return JSON with EXACTLY these string/string[] fields, grounded in the numbers above:',
    '{ "executiveSummary": string, "strengths": string[], "weaknesses": string[], "investmentOutlook": string, "rentalOutlook": string, "exitStrategy": string, "finalRecommendation": string, "negotiationScript": string, "talkingPoints": string[] }',
  ].join('\n');

  try {
    const raw = await llm.complete(prompt, { system: SYSTEM, json: true, temperature: 0.4, maxTokens: 1100 });
    const parsed = JSON.parse(raw) as Partial<AnalysisReport['narrative']> & { mock?: boolean };
    if (parsed.mock || !parsed.executiveSummary) return { report, enriched: false };
    report.narrative = {
      ...report.narrative,
      executiveSummary: parsed.executiveSummary ?? report.narrative.executiveSummary,
      strengths: parsed.strengths?.length ? parsed.strengths : report.narrative.strengths,
      weaknesses: parsed.weaknesses?.length ? parsed.weaknesses : report.narrative.weaknesses,
      investmentOutlook: parsed.investmentOutlook ?? report.narrative.investmentOutlook,
      rentalOutlook: parsed.rentalOutlook ?? report.narrative.rentalOutlook,
      exitStrategy: parsed.exitStrategy ?? report.narrative.exitStrategy,
      finalRecommendation: parsed.finalRecommendation ?? report.narrative.finalRecommendation,
      negotiationScript: parsed.negotiationScript ?? report.narrative.negotiationScript,
      talkingPoints: parsed.talkingPoints?.length ? parsed.talkingPoints : report.narrative.talkingPoints,
    };
    return { report, enriched: true };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'property-intel LLM enrichment failed — deterministic narrative');
    return { report, enriched: false };
  }
}

/**
 * Report-scoped AI chat. Grounded strictly in the computed report so answers
 * are explainable and consistent with the numbers. Deterministic fallback
 * answers common questions from the report data when no LLM key is set.
 */
export async function answerReportQuestion(
  report: AnalysisReport,
  question: string,
): Promise<{ answer: string; live: boolean }> {
  const llm = getLLM();
  const r = report;
  const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

  if (llm.info.live) {
    const prompt = [
      'You are the analyst for THIS property report. Answer the user in 2–4 sentences.',
      'Only use facts from the report JSON below. If asked something not covered, say what the report does show. Cite the numbers.',
      `REPORT: ${JSON.stringify({
        address: r.input.address,
        score: r.investmentScore,
        grade: r.grade,
        recommendation: r.recommendation,
        fairValue: r.fairMarketValue,
        offer: r.offer,
        cashFlow: r.agents.rental.cashFlow,
        strategy: r.agents.strategy,
        neighborhood: r.agents.neighborhood,
        market: r.agents.market,
        risk: r.risk,
        opportunities: r.opportunities,
      })}`,
      `QUESTION: ${question}`,
    ].join('\n');
    try {
      const out = await llm.complete(prompt, {
        system: 'You are a precise, plain-spoken real-estate investment analyst. No markdown headers, no disclaimers.',
        temperature: 0.3,
        maxTokens: 400,
      });
      if (out.trim() && !out.includes('"mock"')) return { answer: out.trim(), live: true };
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'property-intel chat LLM failed — deterministic answer');
    }
  }

  // Deterministic intent-matched answer.
  const q = question.toLowerCase();
  if (/should i (buy|offer)|worth it|good deal/.test(q))
    return { answer: `${r.recommendation}. It scores ${r.investmentScore}/100 (${r.grade}). ${r.narrative.finalRecommendation}`, live: false };
  if (/overpriced|too expensive|fair (value|price)/.test(q))
    return { answer: `Modeled fair value is ${money(r.fairMarketValue.estimated)} vs. ${money(r.fairMarketValue.askingPrice)} asking — ${r.fairMarketValue.verdict.toLowerCase()} by ${Math.abs(r.fairMarketValue.diffPct)}%.`, live: false };
  if (/negotiat|offer|counter/.test(q))
    return { answer: `Suggested offer ${money(r.offer.suggestedOffer)} (range ${money(r.offer.offerRangeLow)}–${money(r.offer.offerRangeHigh)}), walk away above ${money(r.offer.walkAwayAbove)}. ${r.narrative.negotiationScript}`, live: false };
  if (/rent|cash ?flow|cap rate|income/.test(q))
    return { answer: `${r.narrative.rentalOutlook}`, live: false };
  if (/apprecia|future|forecast|grow/.test(q))
    return { answer: `${r.agents.strategy.expectedAppreciationPct}%/yr expected appreciation; 12-month market forecast ${r.agents.market.forecast12moPct >= 0 ? '+' : ''}${r.agents.market.forecast12moPct}%. Neighborhood growth: ${r.agents.neighborhood.growthPotential}.`, live: false };
  if (/risk|danger|flood|crime/.test(q))
    return { answer: `Overall risk is ${r.risk.level.toLowerCase()} (${r.risk.score}/100). Top factors: ${r.risk.factors.filter((f) => f.level !== 'Low').slice(0, 3).map((f) => `${f.label} (${f.level})`).join(', ') || 'none material'}.`, live: false };
  return { answer: `This property scores ${r.investmentScore}/100 (${r.grade}, ${r.recommendation}). ${r.narrative.executiveSummary}`, live: false };
}
