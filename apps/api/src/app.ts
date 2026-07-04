import 'express-async-errors';
import { existsSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { env } from './env.js';
import { logger } from './logger.js';
import { accountRouter } from './routes/account.js';
import { adminRouter } from './routes/admin.js';
import { appointmentsRouter } from './routes/appointments.js';
import { assistantRouter } from './routes/assistant.js';
import { approvalsRouter } from './routes/approvals.js';
import { authRouter } from './routes/auth.js';
import { evalsRouter } from './routes/evals.js';
import { observabilityRouter } from './routes/observability.js';
import { billingRouter, stripeWebhookHandler } from './routes/billing.js';
import { callsRouter } from './routes/calls.js';
import { cmsRouter } from './routes/cms.js';
import { publicCmsRouter } from './routes/public-cms.js';
import { contentRouter } from './routes/content.js';
import { conversationsRouter } from './routes/conversations.js';
import { eventsRouter } from './routes/events.js';
import { integrationsRouter } from './routes/integrations.js';
import { knowledgeRouter } from './routes/knowledge.js';
import { leadEngineRouter } from './routes/leadengine.js';
import { voiceAgentsRouter } from './routes/voice-agents.js';
import { leadsRouter } from './routes/leads.js';
import { membersRouter } from './routes/members.js';
import { orchestratorRouter } from './routes/orchestrator.js';
import { propertyAnalysisRouter } from './routes/property-analysis.js';
import { quotationsRouter } from './routes/quotations.js';
import { invoicingRouter } from './routes/invoicing.js';
import { dealsRouter } from './routes/deals.js';
import { ledgerRouter } from './routes/ledger.js';
import { documentsRouter } from './routes/documents.js';
import { portalRouter } from './routes/portal.js';
import { sequencesRouter } from './routes/sequences.js';
import { statsRouter } from './routes/stats.js';
import { webhookRouter } from './routes/webhooks.js';
import { websiteRouter } from './routes/website.js';

export function createApp(): Express {
  const app = express();
  app.set('trust proxy', 1);

  // Single-service deploy support: the built web app (when present) is served
  // from THIS server and calls the API under /api/*. Strip that prefix so the
  // routers (mounted at root — also used by webhooks, tests and the dev proxy)
  // handle both /leads and /api/leads. Flagged so an unknown /api/* path still
  // 404s as JSON rather than falling through to the SPA shell. No-op in the split
  // deploy (the frontend uses an absolute API URL, so requests never carry /api).
  app.use((req: Request & { isApi?: boolean }, _res, next) => {
    if (req.url === '/api' || req.url.startsWith('/api/')) {
      req.isApi = true;
      req.url = req.url.slice(4) || '/';
    }
    next();
  });

  app.use(helmet());
  // CORS — allow the configured web origin, local dev, and any Vercel/Render
  // deployment (incl. preview URLs) so the split web(Vercel)/api(Render) setup
  // and mobile browsers work without per-deploy config. Reflects the request
  // origin when allowed (required with credentials: true — no wildcard).
  const allowOrigin = (origin: string): boolean =>
    origin === env.appUrl ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ||
    /\.vercel\.app$/.test(origin) ||
    /\.onrender\.com$/.test(origin);
  app.use(
    cors({
      origin: (origin, cb) => {
        // No Origin header (same-origin, curl, native/mobile webviews) → allow.
        if (!origin || allowOrigin(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
    }),
  );

  // Stripe webhook needs the raw body BEFORE json parsing.
  app.post('/webhook/stripe', express.raw({ type: 'application/json' }), stripeWebhookHandler);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false })); // Twilio posts form-encoded
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'truecode-api', ts: new Date().toISOString() });
  });

  // Serve the built SPA in a single-service deploy (API + web on ONE host, one
  // URL). Active only when running the COMPILED server (…/dist/…) with a web
  // build present — so local `tsx watch` dev (Vite serves the app) and the test
  // runner are unaffected, and the split web/api deploy (no web build on the API
  // host) skips it. Placed before the routers so a deep link like /leads renders
  // the app; /api/* (stripped, flagged), /webhook/* and real files fall through.
  const serverDir = dirname(fileURLToPath(import.meta.url));
  const webDist = path.resolve(serverDir, '../../web/dist');
  const serveWeb =
    env.nodeEnv !== 'test' && serverDir.replace(/\\/g, '/').includes('/dist') && existsSync(webDist);
  if (serveWeb) {
    app.use(express.static(webDist, { index: false }));
    app.use((req: Request & { isApi?: boolean }, res, next) => {
      if (req.method !== 'GET' || req.isApi) return next();
      if (req.path.startsWith('/webhook') || req.path.includes('.')) return next();
      res.sendFile(path.join(webDist, 'index.html'));
    });
    logger.info({ webDist }, 'serving web app (single-service mode)');
  }

  app.use('/auth', authRouter);
  app.use('/account', accountRouter);
  app.use('/members', membersRouter);
  app.use('/admin', adminRouter);
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
  app.use('/property-analysis', propertyAnalysisRouter);
  app.use('/quotations', quotationsRouter);
  app.use('/invoicing', invoicingRouter);
  app.use('/deals', dealsRouter);
  app.use('/ledger', ledgerRouter);
  app.use('/documents', documentsRouter);
  app.use('/portal', portalRouter);
  app.use('/cms', cmsRouter);
  app.use('/public-cms', publicCmsRouter);
  app.use('/website', websiteRouter);
  app.use('/webhook', webhookRouter);
  app.use('/events', eventsRouter);
  app.use('/assistant', assistantRouter);
  app.use('/integrations', integrationsRouter);
  app.use('/knowledge', knowledgeRouter);
  app.use('/voice-agents', voiceAgentsRouter);
  app.use('/evals', evalsRouter);
  app.use('/observability', observabilityRouter);
  app.use('/approvals', approvalsRouter);

  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err: err.message, stack: err.stack }, 'unhandled error');
    res.status(500).json({ error: 'internal_error' });
  });

  return app;
}
