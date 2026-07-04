import './env.js';
import { createApp } from './app.js';
import { connectDb } from './db.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { applyStoredIntegrationKeys } from './routes/integrations.js';
import { seedDemo } from './seed.js';
import { registerApprovalExecutors } from './lib/approval-executors.js';
import { registerAdWorkers } from './workers/ads.js';
import { registerContentWorkers } from './workers/content.js';
import { registerEvalWorkers } from './workers/evals.js';
import { registerDripWorker } from './workers/drip.js';
import { registerInstantReplyWorker } from './workers/instant-reply.js';
import { registerLeadEngineWorkers } from './workers/lead-engine.js';
import { registerPropertyAnalysisWorker } from './workers/property-analysis.js';
import { registerVoiceCallWorker } from './workers/voice-call.js';

async function main(): Promise<void> {
  await connectDb();
  await applyStoredIntegrationKeys();

  // Auto-seed the demo account on boot so a fresh/restarted local DB always has
  // a working login (demo@truecode.ai / Demo1234!). Idempotent; opt out with
  // AUTO_SEED_DEMO=0. Skipped for unit tests (they never run main()).
  if (process.env.AUTO_SEED_DEMO !== '0') {
    try {
      const { accountId } = await seedDemo();
      logger.info({ accountId }, 'demo account ready (demo@truecode.ai / Demo1234!)');
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'demo auto-seed skipped');
    }
  }

  registerInstantReplyWorker();
  registerVoiceCallWorker();
  registerDripWorker();
  registerLeadEngineWorkers();
  registerContentWorkers();
  registerAdWorkers();
  registerPropertyAnalysisWorker();
  registerEvalWorkers();
  registerApprovalExecutors();

  const app = createApp();
  app.listen(env.port, () => {
    logger.info({ port: env.port, env: env.nodeEnv }, 'TrueCode AI API listening');
  });
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, 'boot failed');
  process.exit(1);
});
