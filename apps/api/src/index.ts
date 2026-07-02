import './env.js';
import { createApp } from './app.js';
import { connectDb } from './db.js';
import { env } from './env.js';
import { logger } from './logger.js';
import { applyStoredIntegrationKeys } from './routes/integrations.js';
import { registerContentWorkers } from './workers/content.js';
import { registerDripWorker } from './workers/drip.js';
import { registerInstantReplyWorker } from './workers/instant-reply.js';
import { registerLeadEngineWorkers } from './workers/lead-engine.js';
import { registerVoiceCallWorker } from './workers/voice-call.js';

async function main(): Promise<void> {
  await connectDb();
  await applyStoredIntegrationKeys();

  registerInstantReplyWorker();
  registerVoiceCallWorker();
  registerDripWorker();
  registerLeadEngineWorkers();
  registerContentWorkers();

  const app = createApp();
  app.listen(env.port, () => {
    logger.info({ port: env.port, env: env.nodeEnv }, 'CloseFlow API listening');
  });
}

main().catch((err) => {
  logger.fatal({ err: (err as Error).message }, 'boot failed');
  process.exit(1);
});
