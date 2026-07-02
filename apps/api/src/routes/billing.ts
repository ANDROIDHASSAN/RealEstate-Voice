import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { stripe } from '@truecode/integrations';
import { PLANS, modulesForPlan, subscribeSchema, type PlanKey } from '@truecode/shared';
import { env } from '../env.js';
import { logger } from '../logger.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { Account, UsageLedger } from '../models.js';
import { publicAccount } from './auth.js';

export const billingRouter = Router();

billingRouter.get('/plans', (_req: Request, res: Response) => {
  res.json({ plans: Object.values(PLANS) });
});

billingRouter.post('/subscribe', requireAuth, requirePermission('account:billing'), async (req: Request, res: Response) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input' });
  const plan = parsed.data.plan as PlanKey;
  const account = await Account.findById(req.auth!.accountId);
  if (!account) return res.status(404).json({ error: 'not_found' });

  if (!stripe.info.live) {
    // Mock billing (DECISIONS.md #7): apply the plan directly, clearly labeled.
    account.plan = plan;
    account.enabledModules = modulesForPlan(plan);
    await account.save();
    await UsageLedger.create({
      accountId: account._id,
      type: 'aiTokens',
      quantity: 0,
      note: `[MOCK BILLING] plan set to ${plan} without Stripe (no STRIPE_SECRET_KEY)`,
    });
    logger.info({ accountId: String(account._id), plan }, 'mock subscription applied');
    return res.json({ mock: true, account: publicAccount(account.toObject()) });
  }

  if (!account.stripeCustomerId) {
    account.stripeCustomerId = await stripe.createCustomer(account.email, account.name);
    await account.save();
  }
  const session = await stripe.createCheckoutSession({
    customerId: account.stripeCustomerId,
    priceMonthlyUsd: PLANS[plan].priceMonthly,
    planKey: plan,
    successUrl: `${env.appUrl}/billing?success=1`,
    cancelUrl: `${env.appUrl}/billing?canceled=1`,
  });
  return res.json({ checkoutUrl: session.url });
});

billingRouter.get('/usage', requireAuth, async (req: Request, res: Response) => {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const rows = await UsageLedger.aggregate([
    { $match: { accountId: (await Account.findById(req.auth!.accountId))!._id, ts: { $gte: since } } },
    { $group: { _id: '$type', total: { $sum: '$quantity' } } },
  ]);
  res.json({ usage: rows.map((r) => ({ type: r._id, total: r.total })) });
});

/**
 * Stripe webhook. Signature verification uses the raw body; with no
 * STRIPE_WEBHOOK_SECRET (mock mode) the endpoint is disabled (404) so it can
 * never be spoofed.
 */
export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? '';
  if (!secret) {
    res.status(404).json({ error: 'stripe_webhook_disabled' });
    return;
  }
  const sig = req.headers['stripe-signature'];
  if (typeof sig !== 'string') {
    res.status(400).json({ error: 'missing_signature' });
    return;
  }
  const raw = req.body as Buffer;
  if (!verifyStripeSignature(raw, sig, secret)) {
    res.status(400).json({ error: 'bad_signature' });
    return;
  }
  const event = JSON.parse(raw.toString('utf8')) as {
    type: string;
    data: { object: { customer?: string; metadata?: { plan?: string }; status?: string } };
  };
  if (event.type === 'checkout.session.completed' || event.type === 'customer.subscription.updated') {
    const obj = event.data.object;
    const plan = obj.metadata?.plan as PlanKey | undefined;
    if (obj.customer && plan && PLANS[plan]) {
      await Account.updateOne(
        { stripeCustomerId: obj.customer },
        { $set: { plan, enabledModules: modulesForPlan(plan), status: 'active' } },
      );
      logger.info({ customer: obj.customer, plan }, 'stripe subscription applied');
    }
  }
  if (event.type === 'customer.subscription.deleted') {
    const obj = event.data.object;
    if (obj.customer)
      await Account.updateOne({ stripeCustomerId: obj.customer }, { $set: { status: 'past_due' } });
  }
  res.json({ received: true });
}

function verifyStripeSignature(payload: Buffer, header: string, secret: string): boolean {
  try {
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const timestamp = parts.t;
    const expected = parts.v1;
    if (!timestamp || !expected) return false;
    const signed = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload.toString('utf8')}`)
      .digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signed), Buffer.from(expected));
  } catch {
    return false;
  }
}
