import type { PropertyInput } from '@truecode/shared';
import { logger } from '../logger.js';
import { emitAgentEvent } from '../lib/events.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { orchestrateAndEnrich } from '../lib/property-agents.js';
import { PropertyAnalysis, UsageLedger } from '../models.js';

/**
 * Property Intelligence worker — runs the 5-agent analysis asynchronously so the
 * UI can show the crew "working" live. Each specialist emits an activity event
 * (the engine itself is synchronous/fast; the staged events give the multi-agent
 * UX and keep parity with the orchestrator/lead-engine patterns).
 */

const AGENT_STEPS = [
  { key: 'comps-agent', title: 'Comparable Sales Agent — pricing vs. recent sales' },
  { key: 'rental-agent', title: 'Rental Income Agent — cash flow, cap rate, DSCR' },
  { key: 'neighborhood-agent', title: 'Neighborhood Agent — schools, safety, growth' },
  { key: 'strategy-agent', title: 'Investment Strategy Agent — best-fit play + ROI' },
  { key: 'market-agent', title: 'Market Trend Agent — supply, demand, forecast' },
] as const;

export function registerPropertyAnalysisWorker(): void {
  getQueue().process(QUEUES.propertyAnalysis, async (data) => {
    const analysisId = String(data.analysisId);
    const accountId = String(data.accountId);
    const doc = await PropertyAnalysis.findOne({ _id: analysisId, accountId });
    if (!doc) return;

    emitAgentEvent(accountId, {
      type: 'agent:start',
      agentKey: 'property-intel',
      title: `Analyzing ${doc.address}`,
      detail: '5 specialist agents dispatched in parallel',
      status: 'running',
    });

    try {
      // Surface each specialist as it "reports in".
      for (const step of AGENT_STEPS) {
        emitAgentEvent(accountId, {
          type: 'agent:step',
          agentKey: step.key,
          title: step.title,
          status: 'running',
        });
      }

      const { report, enriched } = await orchestrateAndEnrich(doc.input as PropertyInput);

      doc.report = report as never;
      doc.investmentScore = report.investmentScore;
      doc.grade = report.grade;
      doc.recommendation = report.recommendation;
      doc.riskLevel = report.risk.level;
      doc.enriched = enriched;
      doc.status = 'done';
      await doc.save();

      // Analysis consumes AI credits (whether live LLM or engine-only).
      await UsageLedger.create({
        accountId,
        type: 'aiTokens',
        quantity: enriched ? 1200 : 200,
        note: `property-analysis:${analysisId}`,
      });

      emitAgentEvent(accountId, {
        type: 'agent:done',
        agentKey: 'property-intel',
        title: `${doc.address}: ${report.investmentScore}/100 (${report.grade}) — ${report.recommendation}`,
        detail: report.narrative.executiveSummary.slice(0, 160),
        status: 'done',
      });
      logger.info({ analysisId, score: report.investmentScore, enriched }, 'property analysis done');
    } catch (err) {
      doc.status = 'error';
      doc.error = (err as Error).message;
      await doc.save();
      emitAgentEvent(accountId, {
        type: 'agent:error',
        agentKey: 'property-intel',
        title: `Analysis failed — ${doc.address}`,
        detail: (err as Error).message,
        status: 'error',
      });
      throw err;
    }
  });
}
