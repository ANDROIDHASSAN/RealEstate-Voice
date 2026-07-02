import 'express-async-errors';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { env } from './env.js';
import { logger } from './logger.js';
import { accountRouter } from './routes/account.js';
import { appointmentsRouter } from './routes/appointments.js';
import { assistantRouter } from './routes/assistant.js';
import { authRouter } from './routes/auth.js';
import { billingRouter, stripeWebhookHandler } from './routes/billing.js';
import { callsRouter } from './routes/calls.js';
import { contentRouter } from './routes/content.js';
import { conversationsRouter } from './routes/conversations.js';
import { eventsRouter } from './routes/events.js';
import { integrationsRouter } from './routes/integrations.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { leadEngineRouter } from './routes/leadengine.js';
import { voiceAgentsRouter } from './routes/voice-agents.js';
import { leadsRouter } from './routes/leads.js';
import { orchestratorRouter } from './routes/orchestrator.js';
import { sequencesRouter } from './routes/sequences.js';
import { statsRouter } from './routes/stats.js';
import { webhookRouter } from './routes/webhooks.js';
import { websiteRouter } from './routes/website.js';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: [env.appUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'],
      credentials: true,
    }),
  );

  // Stripe webhook needs the raw body BEFORE json parsing.
  app.post('/webhook/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'closeflow-api', ts: new Date().toISOString() });
  });

  app.use('/auth', authRouter);
  app.use('/account', accountRouter);
  app.use('/billing', billingRouter);
  app.use('/leads', leadsRouter);
  app.use('/calls', callsRouter);
  app.use('/appointments', appointmentsRouter);
  app.use('/sequences', sequencesRouter);
  app.use('/conversations', conversationsRouter);
  app.use('/stats', statsRouter);
  app.use('/lead-engine', leadEngineRouter);
  app.use('/content', contentRouter);
  app.use('/orchestrator', orchestratorRouter);
  app.use('/website', websiteRouter);
  app.use('/webhook', webhookRouter);
  app.use('/events', eventsRouter);
  app.use('/assistant', assistantRouter);
  app.use('/integrations', integrationsRouter);
  app.use('/knowledge', knowledgeRouter);
  app.use('/voice-agents', voiceAgentsRouter);

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, 'unhandled error');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
