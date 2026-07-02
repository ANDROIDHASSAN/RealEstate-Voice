import { Router, type Request, type Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../env.js';
import { requireAuth, type AuthContext } from '../middleware/auth.js';
import { recentAgentEvents, subscribeAgentEvents } from '../lib/events.js';
import { AgentRun } from '../models.js';

export const eventsRouter = Router();

/**
 * SSE live stream. EventSource cannot set an Authorization header, so this
 * endpoint accepts the short-lived access token as `?token=` and verifies it
 * the same way requireAuth does.
 */
eventsRouter.get('/stream', (req: Request, res: Response) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  let auth: AuthContext;
  try {
    const p = jwt.verify(token, env.jwtSecret) as AuthContext & Record<string, unknown>;
    auth = { userId: p.userId, accountId: p.accountId, role: p.role };
  } catch {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  const unsubscribe = subscribeAgentEvents(auth.accountId, (event) => {
    res.write(`event: agent\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

/** Polling fallback + initial paint for the live activity feed. */
eventsRouter.get('/recent', requireAuth, (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ items: recentAgentEvents(req.auth!.accountId, limit) });
});

/** Durable agent-run history (Mongo) — powers the Agents page timeline. */
eventsRouter.get('/agent-runs', requireAuth, async (req: Request, res: Response) => {
  const items = await AgentRun.find({ accountId: req.auth!.accountId })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  res.json({ items });
});
