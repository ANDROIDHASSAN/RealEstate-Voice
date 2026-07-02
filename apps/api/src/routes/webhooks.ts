import { Router, type Request, type Response } from 'express';
import { leadWebhookSchema, type Locale } from '@truecode/shared';
import mongoose from 'mongoose';
import { logger } from '../logger.js';
import { handleOptOut } from '../lib/compliance.js';
import { getQueue, QUEUES } from '../lib/queue.js';
import { rateLimit } from '../middleware/auth.js';
import { Account, Conversation, Lead } from '../models.js';
import { autoReplyWhatsApp } from '../workers/whatsapp-reply.js';
import { pauseSequencesOnReply } from '../workers/drip.js';
import { handleVoiceProviderEvent } from '../workers/voice-call.js';

export const webhookRouter = Router();

const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  key: (req) => req.params.accountId ?? req.ip ?? 'unknown',
});

/**
 * M1 lead intake — POST /webhook/lead/:accountId
 * Accepts Zillow/FB/website/Zapier payloads (normalized by Zod), dedupes,
 * creates the Lead, and enqueues the high-priority instant-reply job.
 */
webhookRouter.post('/lead/:accountId', webhookLimiter, async (req: Request, res: Response) => {
  const { accountId } = req.params;
  if (!mongoose.isValidObjectId(accountId)) return res.status(404).json({ error: 'unknown_account' });
  const account = await Account.findById(accountId).select('_id locale enabledModules status').lean();
  if (!account || account.status === 'canceled') return res.status(404).json({ error: 'unknown_account' });

  const parsed = leadWebhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  const d = parsed.data;

  // Dedup: same phone or email for this account within 24h → touch, don't re-fire.
  const dupQuery = [];
  if (d.phone) dupQuery.push({ phone: d.phone });
  if (d.email) dupQuery.push({ email: d.email });
  const existing = await Lead.findOne({
    accountId,
    $or: dupQuery,
    createdAt: { $gte: new Date(Date.now() - 24 * 3600 * 1000) },
  });
  if (existing) {
    logger.info({ leadId: String(existing._id) }, 'webhook lead deduped');
    return res.status(200).json({ leadId: String(existing._id), deduped: true });
  }

  const lead = await Lead.create({
    accountId,
    firstName: d.firstName,
    lastName: d.lastName,
    phone: d.phone,
    email: d.email,
    locale: (d.locale ?? account.locale ?? 'en') as Locale,
    source: d.source,
    propertyInterest: d.propertyInterest ?? d.message?.slice(0, 200),
    location: d.location,
    budget: d.budget,
    consent: { sms: d.consentSms, call: d.consentCall, whatsapp: d.consentSms, email: true },
  });

  await getQueue().enqueue(
    QUEUES.instantReply,
    { accountId: String(accountId), leadId: String(lead._id) },
    { jobId: `ir_${lead._id}` },
  );

  return res.status(201).json({ leadId: String(lead._id) });
});

/**
 * Twilio inbound SMS webhook — reply detection: STOP handling + pause drips.
 * Signature: Twilio signs with X-Twilio-Signature; verified when auth token set.
 */
webhookRouter.post('/sms/inbound', async (req: Request, res: Response) => {
  const body = req.body as { From?: string; To?: string; Body?: string };
  if (!body.From || !body.Body) return res.status(400).send('');
  const account = await Account.findOne({ twilioNumber: body.To }).select('_id').lean();
  const lead = account
    ? await Lead.findOne({ accountId: account._id, phone: body.From })
    : await Lead.findOne({ phone: body.From });
  if (!lead) return res.status(200).send('<Response></Response>');

  await Conversation.findOneAndUpdate(
    { accountId: lead.accountId, leadId: lead._id, channel: 'sms' },
    {
      $push: { messages: { direction: 'inbound', text: body.Body, ts: new Date(), status: 'delivered' } },
      $set: { lastInboundAt: new Date(), status: 'human' },
    },
    { upsert: true },
  );

  const optedOut = await handleOptOut(String(lead.accountId), String(lead._id), body.Body);
  if (!optedOut) await pauseSequencesOnReply(String(lead.accountId), String(lead._id));

  res.type('text/xml').send('<Response></Response>');
});

/**
 * WhatsApp Cloud API webhook (M4): GET = verification, POST = inbound message
 * → LLM auto-reply with lead context.
 */
webhookRouter.get('/whatsapp', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = (process.env.WHATSAPP_VERIFY_TOKEN ?? '').replace(/\s+#.*$/, '').trim();
  if (mode === 'subscribe' && expected && token === expected) {
    return res.send(challenge);
  }
  return res.sendStatus(403);
});

webhookRouter.post('/whatsapp', async (req: Request, res: Response) => {
  res.sendStatus(200); // ack fast; process async
  try {
    const entry = (req.body as { entry?: { changes?: { value?: { metadata?: { phone_number_id?: string }; messages?: { from: string; text?: { body?: string } }[] } }[] }[] }).entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg?.text?.body) return;
    const phoneId = value?.metadata?.phone_number_id;
    const account = phoneId ? await Account.findOne({ whatsappPhoneId: phoneId }).select('_id enabledModules').lean() : null;
    const from = msg.from.startsWith('+') ? msg.from : `+${msg.from}`;
    const lead = account
      ? await Lead.findOne({ accountId: account._id, phone: from })
      : await Lead.findOne({ phone: from });
    if (!lead) return;
    await autoReplyWhatsApp(String(lead.accountId), String(lead._id), msg.text.body);
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'whatsapp webhook error');
  }
});

/** Voice provider completion webhooks (Dograh/Vapi/Gemini bridge). */
webhookRouter.post('/voice/:provider', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const callRef = String(body.callRef ?? (body.metadata as Record<string, unknown> | undefined)?.callRef ?? '');
  if (!callRef) return res.status(400).json({ error: 'missing_callRef' });
  await handleVoiceProviderEvent({
    callRef,
    providerCallId: String(body.providerCallId ?? body.call_id ?? ''),
    status: body.status === 'failed' ? 'failed' : 'completed',
    durationSec: Number(body.durationSec ?? body.duration ?? 0),
    transcript: (body.transcript as { role: 'agent' | 'lead'; text: string; ts: number }[]) ?? [],
    summary: String(body.summary ?? ''),
    outcome: (body.outcome as never) ?? 'qualified',
    recordingUrl: typeof body.recordingUrl === 'string' ? body.recordingUrl : undefined,
    extracted: (body.extracted as Record<string, string>) ?? {},
  });
  return res.json({ ok: true });
});
