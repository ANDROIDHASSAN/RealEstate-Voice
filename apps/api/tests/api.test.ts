import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

process.env.FORCE_MOCK_PROVIDERS = '1';
process.env.COMPLIANCE_IGNORE_QUIET_HOURS = '1';
process.env.MONGO_URI = '';
process.env.REDIS_URL = '';
process.env.MOCK_CALL_DELAY_MS = '300';

const { connectDb, disconnectDb } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { registerInstantReplyWorker } = await import('../src/workers/instant-reply.js');
const { registerVoiceCallWorker } = await import('../src/workers/voice-call.js');
const { registerPropertyAnalysisWorker } = await import('../src/workers/property-analysis.js');
const { closeQueue } = await import('../src/lib/queue.js');

let app: Express;
let tokenA = '';
let tokenB = '';
let accountAId = '';
let accountBId = '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await connectDb();
  registerInstantReplyWorker();
  registerVoiceCallWorker();
  registerPropertyAnalysisWorker();
  app = createApp();

  const a = await request(app).post('/auth/signup').send({
    accountName: 'Tenant A', name: 'Alice A', email: 'a@test.io', password: 'Passw0rd!123',
  });
  tokenA = a.body.accessToken;
  accountAId = a.body.account._id;
  const b = await request(app).post('/auth/signup').send({
    accountName: 'Tenant B', name: 'Bob B', email: 'b@test.io', password: 'Passw0rd!123',
  });
  tokenB = b.body.accessToken;
  accountBId = b.body.account._id;
}, 120_000);

afterAll(async () => {
  await closeQueue();
  await disconnectDb();
});

describe('auth & authz', () => {
  it('rejects bad credentials', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'a@test.io', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('keeps the session alive: login → refresh issues a new access token', async () => {
    // A cookie-carrying agent mimics the browser; the refresh cookie (path "/")
    // must come back on /auth/refresh so the session never silently expires.
    const agent = request.agent(app);
    const login = await agent.post('/auth/login').send({ email: 'a@test.io', password: 'Passw0rd!123' });
    expect(login.status).toBe(200);
    expect(login.headers['set-cookie']?.some((c: string) => c.startsWith('cf_refresh='))).toBe(true);
    const refreshed = await agent.post('/auth/refresh').send();
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.accessToken).toBeTruthy();
    // The new access token authenticates a protected route
    const me = await request(app).get('/account/me').set('Authorization', `Bearer ${refreshed.body.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('requires auth on protected routes', async () => {
    expect((await request(app).get('/leads')).status).toBe(401);
    expect((await request(app).get('/account/me')).status).toBe(401);
  });

  it('validates signup input (Zod)', async () => {
    const res = await request(app).post('/auth/signup').send({ email: 'nope', password: '1' });
    expect(res.status).toBe(400);
  });
});

describe('module gating', () => {
  it('starter cannot hit pro endpoints (403 module_not_enabled)', async () => {
    for (const path of ['/calls', '/sequences', '/lead-engine/jobs', '/orchestrator/runs']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${tokenA}`);
      expect(res.status, path).toBe(403);
      expect(res.body.error).toBe('module_not_enabled');
    }
  });

  it('mock subscribe unlocks modules', async () => {
    const res = await request(app)
      .post('/billing/subscribe')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ plan: 'pro' });
    expect(res.body.account.enabledModules).toContain('voice');
    expect((await request(app).get('/calls').set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
    // Pro still lacks Empire modules
    expect((await request(app).get('/lead-engine/jobs').set('Authorization', `Bearer ${tokenA}`)).status).toBe(403);
  });

  it('the Ultimate plan unlocks every module', async () => {
    const { MODULES } = await import('@truecode/shared');
    const res = await request(app).post('/billing/subscribe').set('Authorization', `Bearer ${tokenA}`).send({ plan: 'ultimate' });
    expect(res.body.account.plan).toBe('ultimate');
    for (const flag of Object.values(MODULES)) expect(res.body.account.enabledModules).toContain(flag);
    // Previously-empire-only endpoints are now reachable.
    expect((await request(app).get('/lead-engine/jobs').set('Authorization', `Bearer ${tokenA}`)).status).toBe(200);
    // reset A back to pro so later tests keep their expectations
    await request(app).post('/billing/subscribe').set('Authorization', `Bearer ${tokenA}`).send({ plan: 'pro' });
  });
});

describe('lead intake + tenant isolation', () => {
  it('webhook creates a lead and instant reply fires', async () => {
    const res = await request(app)
      .post(`/webhook/lead/${accountAId}`)
      .send({ firstName: 'Iso', phone: '+13055558801', source: 'zillow' });
    expect(res.status).toBe(201);
    await sleep(1500);
    const lead = await request(app).get(`/leads/${res.body.leadId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(lead.body.lead.firstResponseSeconds).toBeDefined();
  });

  it('account B cannot see or fetch account A leads', async () => {
    const listB = await request(app).get('/leads').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.items).toHaveLength(0);
    const leadsA = await request(app).get('/leads').set('Authorization', `Bearer ${tokenA}`);
    const leadAId = leadsA.body.items[0]._id;
    const cross = await request(app).get(`/leads/${leadAId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(cross.status).toBe(404);
  });

  it('rejects invalid webhook payloads (Zod)', async () => {
    const res = await request(app).post(`/webhook/lead/${accountAId}`).send({ firstName: 'NoContact' });
    expect(res.status).toBe(400);
  });

  it('unknown account webhook 404s', async () => {
    const res = await request(app)
      .post('/webhook/lead/000000000000000000000000')
      .send({ firstName: 'X', phone: '+15550001' });
    expect(res.status).toBe(404);
  });
});

describe('assistant commands', () => {
  it('navigate command returns a client action', async () => {
    const res = await request(app)
      .post('/assistant/command')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ text: 'go to leads', locale: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.plan).toContain('navigate');
    expect(res.body.clientAction.path).toBe('/leads');
  });

  it('create lead command actually creates a scoped lead', async () => {
    const res = await request(app)
      .post('/assistant/command')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ text: 'add lead Casper Test phone +13055557777', locale: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.plan).toContain('create_lead');
    const leads = await request(app).get('/leads?limit=100').set('Authorization', `Bearer ${tokenA}`);
    const created = leads.body.items.find((l: { firstName: string }) => l.firstName === 'Casper');
    expect(created).toBeDefined();
    expect(created.consent.sms).toBe(false); // no TCPA consent from voice/typed entry
  });

  it('unintelligible command asks to clarify instead of acting', async () => {
    const res = await request(app)
      .post('/assistant/command')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ text: 'purple monkey dishwasher', locale: 'en' });
    expect(res.body.plan).toContain('clarify');
  });

  it('scrape command respects module gating (pro plan lacks leadEngine)', async () => {
    const res = await request(app)
      .post('/assistant/command')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ text: 'find luxury buyers in Miami', locale: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.reply).toMatch(/plan|Empire/i);
  });

  it('decomposes a compound command into a multi-step plan', async () => {
    const res = await request(app)
      .post('/assistant/command')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ text: 'add lead Nova Reyes and go to leads', locale: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.plan).toEqual(['create_lead', 'navigate']);
    const leads = await request(app).get('/leads?limit=100').set('Authorization', `Bearer ${tokenA}`);
    expect(leads.body.items.some((l: { firstName: string }) => l.firstName === 'Nova')).toBe(true);
  });

  it('answers data questions from account context (no LLM needed)', async () => {
    const res = await request(app)
      .post('/assistant/command')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ text: 'how many leads do I have?', locale: 'en' });
    expect(res.body.plan).toContain('answer');
    expect(res.body.reply).toMatch(/\d+ leads? total/i);
  });

  it('bulk message on a fresh account touches zero leads gracefully', async () => {
    const res = await request(app)
      .post('/assistant/command')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ text: 'message all new leads', locale: 'en' });
    expect(res.status).toBe(200);
    expect(res.body.plan).toContain('message_leads');
  });

  it('exposes an account context snapshot', async () => {
    const res = await request(app).get('/assistant/context').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.context).toHaveProperty('totalLeads');
    expect(res.body.context).toHaveProperty('modules');
    expect(Array.isArray(res.body.context.recentLeads)).toBe(true);
  });
});

describe('knowledge base (RAG)', () => {
  it('ingests a document into chunks and lists it', async () => {
    const res = await request(app)
      .post('/knowledge')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Financing FAQ',
        content: 'We offer conventional and FHA financing. First-time buyers can put down as little as 3.5 percent. Pre-approval takes about 24 hours. We work with three preferred local lenders in Miami.',
      });
    expect(res.status).toBe(201);
    expect(res.body.chunkCount).toBeGreaterThan(0);
    const list = await request(app).get('/knowledge').set('Authorization', `Bearer ${tokenA}`);
    expect(list.body.docs.some((d: { title: string }) => d.title === 'Financing FAQ')).toBe(true);
  });

  it('retrieves relevant chunks for a query (keyword mode in tests)', async () => {
    const res = await request(app)
      .post('/knowledge/search')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ query: 'how much down payment for first-time buyers?' });
    expect(res.status).toBe(200);
    expect(res.body.chunks.length).toBeGreaterThan(0);
    expect(res.body.chunks[0].text.toLowerCase()).toContain('first-time');
  });

  it('uploads a text document (multipart) and ingests it', async () => {
    const res = await request(app)
      .post('/knowledge/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', Buffer.from('Our office is open Monday to Friday, 9am to 6pm, in Coral Gables.'), 'hours.txt');
    expect(res.status).toBe(201);
    expect(res.body.chunkCount).toBeGreaterThan(0);
    const search = await request(app)
      .post('/knowledge/search')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ query: 'when are you open?' });
    expect(search.body.chunks.some((c: { text: string }) => /coral gables/i.test(c.text))).toBe(true);
  });

  it('rejects an upload with no file', async () => {
    const res = await request(app).post('/knowledge/upload').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(400);
  });

  it('validates the URL import input', async () => {
    const res = await request(app).post('/knowledge/url').set('Authorization', `Bearer ${tokenA}`).send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  it('saves the account-wide voice system prompt', async () => {
    const res = await request(app)
      .put('/knowledge/prompt')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ systemPrompt: 'Always be warm and never pushy. Disclose recording.' });
    expect(res.status).toBe(200);
    expect(res.body.systemPrompt).toMatch(/warm/);
  });

  it('keeps knowledge tenant-scoped', async () => {
    const res = await request(app).get('/knowledge').set('Authorization', `Bearer ${tokenB}`);
    expect(res.body.docs).toHaveLength(0);
  });
});

describe('voice agent studio', () => {
  it('lists agents with the full builder catalog', async () => {
    const res = await request(app).get('/voice-agents').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.agents.length).toBeGreaterThan(0);
    expect(res.body.catalog.tools.some((t: { value: string }) => t.value === 'queryKnowledge')).toBe(true);
    expect(res.body.catalog.voiceProviders.length).toBeGreaterThan(0);
  });

  it('saves a per-agent override (model/voice/prompt/tools)', async () => {
    const res = await request(app)
      .put('/voice-agents/speed-to-lead')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ modelProvider: 'openai', modelName: 'gpt-4o', voiceProvider: '11labs', voiceId: 'sarah', systemPrompt: 'Be concise.', tools: ['bookAppointment', 'queryKnowledge', 'notATool'] });
    expect(res.status).toBe(200);
    expect(res.body.agent.modelName).toBe('gpt-4o');
    expect(res.body.agent.voiceId).toBe('sarah');
    // unknown tool filtered out
    expect(res.body.agent.tools).not.toContain('notATool');
    expect(res.body.agent.tools).toContain('queryKnowledge');
  });

  it('browser demo: agent greets first, then replies to a message', async () => {
    const first = await request(app)
      .post('/voice-agents/speed-to-lead/demo')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ messages: [] });
    expect(first.status).toBe(200);
    expect(first.body.reply.length).toBeGreaterThan(0);
    const reply = await request(app)
      .post('/voice-agents/speed-to-lead/demo')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ messages: [{ role: 'agent', text: first.body.reply }, { role: 'user', text: "Hi, I'm looking to buy a condo in Brickell." }] });
    expect(reply.status).toBe(200);
    expect(typeof reply.body.reply).toBe('string');
    expect(reply.body.reply.length).toBeGreaterThan(0);
  });

  it('creates and deletes a custom agent', async () => {
    const created = await request(app).post('/voice-agents').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Listing Concierge' });
    expect(created.status).toBe(201);
    expect(created.body.agent.custom).toBe(true);
    const key = created.body.agent.key;
    const list = await request(app).get('/voice-agents').set('Authorization', `Bearer ${tokenA}`);
    expect(list.body.agents.some((a: { key: string }) => a.key === key)).toBe(true);
    const del = await request(app).delete(`/voice-agents/${key}`).set('Authorization', `Bearer ${tokenA}`);
    expect(del.status).toBe(200);
  });
});

describe('voice self-test', () => {
  it('exposes test-info (provider + inbound number)', async () => {
    const res = await request(app).get('/calls/test-info').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('provider');
    expect(res.body).toHaveProperty('inboundNumber');
  });

  it('places a self-test call to the given number and creates a Call', async () => {
    const res = await request(app)
      .post('/calls/test')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ agentKey: 'speed-to-lead', phone: '+13055550123' });
    expect(res.status).toBe(202);
    expect(res.body.leadId).toBeTruthy();
    await sleep(1500);
    const calls = await request(app).get('/calls').set('Authorization', `Bearer ${tokenA}`);
    const testCall = calls.body.items.find((c: { leadId?: { _id?: string } }) => c.leadId?._id === res.body.leadId);
    expect(testCall).toBeDefined();
    expect(['ringing', 'in-progress', 'completed']).toContain(testCall.status);
  });

  it('reuses one test lead (does not pile up test leads)', async () => {
    await request(app).post('/calls/test').set('Authorization', `Bearer ${tokenA}`).send({ agentKey: 'speed-to-lead', phone: '+13055550124' });
    const leads = await request(app).get('/leads?limit=100').set('Authorization', `Bearer ${tokenA}`);
    const testLeads = leads.body.items.filter((l: { source: string }) => l.source === 'test');
    expect(testLeads).toHaveLength(1);
  });

  it('requires the voice module (starter plan is blocked)', async () => {
    const s = await request(app).post('/auth/signup').send({
      accountName: 'Starter Co', name: 'Sam', email: `starter${Date.now()}@test.io`, password: 'Passw0rd!123',
    });
    const res = await request(app)
      .post('/calls/test')
      .set('Authorization', `Bearer ${s.body.accessToken}`)
      .send({ agentKey: 'speed-to-lead', phone: '+13055550125' });
    expect(res.status).toBe(403);
  });
});

describe('agent activity events', () => {
  it('records outbound activity in the per-account feed', async () => {
    const res = await request(app).get('/events/recent').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    // Instant-reply run earlier in this suite must be visible
    expect(res.body.items.some((e: { agentKey: string }) => e.agentKey === 'instant-reply')).toBe(true);
  });

  it('tenant B never sees tenant A activity', async () => {
    const res = await request(app).get('/events/recent').set('Authorization', `Bearer ${tokenB}`);
    // B may have its own events, but none of A's (e.g. A's instant-reply runs).
    expect(res.body.items.some((e: { agentKey: string }) => e.agentKey === 'instant-reply')).toBe(false);
  });

  it('SSE stream rejects missing/invalid tokens', async () => {
    expect((await request(app).get('/events/stream')).status).toBe(401);
    expect((await request(app).get('/events/stream?token=garbage')).status).toBe(401);
  });
});

describe('integration key management', () => {
  it('lists the provider catalog with masked values', async () => {
    const res = await request(app).get('/integrations').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const twilio = res.body.providers.find((p: { key: string }) => p.key === 'twilio');
    expect(twilio.fields.map((f: { var: string }) => f.var)).toContain('TWILIO_AUTH_TOKEN');
  });

  it('saves a key, masks it on read, and never echoes the raw value', async () => {
    const res = await request(app)
      .put('/integrations/apify')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ values: { APIFY_TOKEN: 'apify_secret_token_12345' } });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('apify_secret_token_12345');
    const list = await request(app).get('/integrations').set('Authorization', `Bearer ${tokenA}`);
    const apify = list.body.providers.find((p: { key: string }) => p.key === 'apify');
    const field = apify.fields.find((f: { var: string }) => f.var === 'APIFY_TOKEN');
    expect(field.configured).toBe(true);
    expect(field.maskedValue).not.toContain('secret_token');
    delete process.env.APIFY_TOKEN; // don't leak into later tests
  });

  it('lists selectable model/provider dropdowns with current values', async () => {
    const res = await request(app).get('/integrations').set('Authorization', `Bearer ${tokenA}`);
    const llm = res.body.providers.find((p: { key: string }) => p.key === 'llm');
    const pref = llm.options.find((o: { var: string }) => o.var === 'LLM_PROVIDER');
    expect(pref.value).toBe('auto'); // default
    expect(pref.choices.map((c: { value: string }) => c.value)).toEqual(expect.arrayContaining(['gemini', 'groq', 'openai']));
    const voice = res.body.providers.find((p: { key: string }) => p.key === 'voice');
    expect(voice.options.some((o: { var: string }) => o.var === 'VOICE_TTS_PROVIDER')).toBe(true);
  });

  it('saves a model selection and reflects it back', async () => {
    const res = await request(app)
      .put('/integrations/llm')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ values: { LLM_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-4o' } });
    expect(res.status).toBe(200);
    const list = await request(app).get('/integrations').set('Authorization', `Bearer ${tokenA}`);
    const llm = list.body.providers.find((p: { key: string }) => p.key === 'llm');
    expect(llm.options.find((o: { var: string }) => o.var === 'LLM_PROVIDER').value).toBe('openai');
    expect(llm.options.find((o: { var: string }) => o.var === 'OPENAI_MODEL').value).toBe('gpt-4o');
    // reset so provider preference doesn't leak into other tests
    delete process.env.LLM_PROVIDER;
    delete process.env.OPENAI_MODEL;
  });

  it('rejects a dropdown value outside its declared choices', async () => {
    const res = await request(app)
      .put('/integrations/llm')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ values: { LLM_PROVIDER: 'skynet' } });
    expect(res.status).toBe(400);
  });

  it('rejects unknown providers and env vars outside the catalog', async () => {
    const bad = await request(app)
      .put('/integrations/nope')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ values: { X: 'y' } });
    expect(bad.status).toBe(404);
    const inject = await request(app)
      .put('/integrations/twilio')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ values: { PATH: 'evil' } });
    expect(inject.status).toBe(400);
  });
});

describe('property intelligence', () => {
  let analysisId = '';

  it('runs the multi-agent analysis and returns a full report', async () => {
    // Account A is on the pro plan by now (module gating test subscribed it) → has propertyIntel.
    const create = await request(app)
      .post('/property-analysis')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ address: '742 Brickell Bay Dr', city: 'Miami', state: 'FL', zip: '33131', propertyType: 'condo', askingPrice: 525000, sqft: 1180, bedrooms: 2, bathrooms: 2, yearBuilt: 2016, estimatedRentMonthly: 3600, hoaMonthly: 650 });
    expect(create.status).toBe(202);
    analysisId = create.body.id;

    let doc: { status: string; report?: Record<string, unknown> } | undefined;
    for (let i = 0; i < 20 && doc?.status !== 'done'; i += 1) {
      await sleep(300);
      const g = await request(app).get(`/property-analysis/${analysisId}`).set('Authorization', `Bearer ${tokenA}`);
      doc = g.body.analysis;
    }
    expect(doc?.status).toBe('done');
    const report = doc!.report as Record<string, any>;
    expect(report.investmentScore).toBeGreaterThanOrEqual(0);
    expect(report.investmentScore).toBeLessThanOrEqual(100);
    expect(report.grade).toBeTruthy();
    expect(report.agents.comps.comps.length).toBe(5);
    expect(report.agents.rental.cashFlow.capRatePct).toBeGreaterThan(0);
    expect(['Strong Buy', 'Buy', 'Hold', 'Negotiate', 'Wait', 'Avoid']).toContain(report.recommendation);
    // Weighted score = weighted sum of the 5 agents (25/20/20/20/15).
    const sum = report.weightedBreakdown.reduce((s: number, b: { contribution: number }) => s + b.contribution, 0);
    expect(Math.abs(sum - report.investmentScore)).toBeLessThanOrEqual(1);
  });

  it('is deterministic — same property yields the same score', async () => {
    const body = { address: '742 Brickell Bay Dr', city: 'Miami', state: 'FL', zip: '33131', propertyType: 'condo', askingPrice: 525000, sqft: 1180, bedrooms: 2, bathrooms: 2, yearBuilt: 2016, estimatedRentMonthly: 3600, hoaMonthly: 650 };
    const c = await request(app).post('/property-analysis').set('Authorization', `Bearer ${tokenA}`).send(body);
    let doc: { status: string; investmentScore?: number } | undefined;
    for (let i = 0; i < 20 && doc?.status !== 'done'; i += 1) {
      await sleep(300);
      doc = (await request(app).get(`/property-analysis/${c.body.id}`).set('Authorization', `Bearer ${tokenA}`)).body.analysis;
    }
    const first = (await request(app).get(`/property-analysis/${analysisId}`).set('Authorization', `Bearer ${tokenA}`)).body.analysis.investmentScore;
    expect(doc?.investmentScore).toBe(first);
  });

  it('answers a grounded question about the report', async () => {
    const res = await request(app)
      .post(`/property-analysis/${analysisId}/chat`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ question: 'Is this overpriced?' });
    expect(res.status).toBe(200);
    expect(res.body.answer.length).toBeGreaterThan(0);
    expect(res.body.chat.length).toBe(2);
  });

  it('keeps analyses tenant-scoped', async () => {
    // Give B the module so we test true ownership scoping (404), not the gate (403).
    await request(app).post('/billing/subscribe').set('Authorization', `Bearer ${tokenB}`).send({ plan: 'pro' });
    const cross = await request(app).get(`/property-analysis/${analysisId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(cross.status).toBe(404);
    const listB = await request(app).get('/property-analysis').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.items).toHaveLength(0);
  });

  it('gates the module (fresh starter account is blocked)', async () => {
    const s = await request(app).post('/auth/signup').send({
      accountName: 'PI Starter', name: 'Pat', email: `pi${Date.now()}@test.io`, password: 'Passw0rd!123',
    });
    const res = await request(app)
      .post('/property-analysis')
      .set('Authorization', `Bearer ${s.body.accessToken}`)
      .send({ address: '1 Main St', city: 'Miami', state: 'FL', askingPrice: 300000, sqft: 1000 });
    expect(res.status).toBe(403);
  });

  it('validates the property input (Zod)', async () => {
    const res = await request(app)
      .post('/property-analysis')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ address: 'x', city: 'Miami', state: 'FL' });
    expect(res.status).toBe(400);
  });
});

describe('quotations', () => {
  let quoteId = '';

  it('lists the real-estate template catalog', async () => {
    const res = await request(app).get('/quotations/templates').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.templates.some((t: { key: string }) => t.key === 'listing-premium')).toBe(true);
  });

  it('creates a quote with server-computed totals', async () => {
    const res = await request(app)
      .post('/quotations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        title: 'Listing Proposal', client: { name: 'Dana Buyer', email: 'dana@example.com' },
        propertyAddress: '10 Ocean Dr', currency: 'USD', taxRatePct: 10, discountType: 'amount', discountValue: 100,
        lineItems: [{ description: 'Photography', quantity: 1, unitPrice: 300 }, { description: 'Staging', quantity: 2, unitPrice: 200 }],
      });
    expect(res.status).toBe(201);
    quoteId = res.body.quote._id;
    // subtotal 700, -100 discount = 600, +10% tax = 660
    expect(res.body.quote.totals.subtotal).toBe(700);
    expect(res.body.quote.totals.discountAmount).toBe(100);
    expect(res.body.quote.totals.total).toBe(660);
    expect(res.body.quote.number).toMatch(/^QT-\d{4}-\d{4}$/);
    expect(res.body.quote.status).toBe('draft');
  });

  it('ignores client-supplied totals (recomputed server-side)', async () => {
    const res = await request(app)
      .post('/quotations')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Tamper', client: { name: 'X' }, lineItems: [{ description: 'A', quantity: 1, unitPrice: 50 }], totals: { total: 999999 } });
    expect(res.status).toBe(201);
    expect(res.body.quote.totals.total).toBe(50);
  });

  it('sends a quote and advances its status', async () => {
    const sent = await request(app).post(`/quotations/${quoteId}/send`).set('Authorization', `Bearer ${tokenA}`);
    expect(sent.body.quote.status).toBe('sent');
    expect(sent.body.quote.sentAt).toBeTruthy();
    const accepted = await request(app).patch(`/quotations/${quoteId}/status`).set('Authorization', `Bearer ${tokenA}`).send({ status: 'accepted' });
    expect(accepted.body.quote.status).toBe('accepted');
  });

  it('locks an accepted quote from edits', async () => {
    const res = await request(app)
      .put(`/quotations/${quoteId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ title: 'Changed', client: { name: 'Dana' }, lineItems: [{ description: 'A', quantity: 1, unitPrice: 1 }] });
    expect(res.status).toBe(409);
  });

  it('duplicates a quote as a fresh draft', async () => {
    const res = await request(app).post(`/quotations/${quoteId}/duplicate`).set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(201);
    expect(res.body.quote.status).toBe('draft');
    expect(res.body.quote.number).not.toBe(quoteId);
  });

  it('reports pipeline stats', async () => {
    const res = await request(app).get('/quotations/stats').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.byStatus).toHaveProperty('accepted');
    expect(res.body.acceptedValue).toBeGreaterThan(0);
  });

  it('keeps quotes tenant-scoped', async () => {
    const cross = await request(app).get(`/quotations/${quoteId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(cross.status).toBe(404);
  });

  it('validates input (Zod)', async () => {
    const res = await request(app).post('/quotations').set('Authorization', `Bearer ${tokenA}`).send({ title: 'x', client: {}, lineItems: [] });
    expect(res.status).toBe(400);
  });
});

describe('owner suite — invoicing, deals, ledger, documents, portal', () => {
  // Account A is on the pro plan (has the owner-suite modules).
  let invoiceId = '';
  let quoteToken = '';
  let docId = '';
  let docToken = '';

  it('creates an invoice with server totals and records a payment to paid', async () => {
    const created = await request(app).post('/invoicing').set('Authorization', `Bearer ${tokenA}`).send({
      title: 'Listing services', client: { name: 'Pat Seller', email: 'pat@example.com' }, currency: 'USD',
      taxRatePct: 0, dueDays: 14, lineItems: [{ description: 'Photography', quantity: 1, unitPrice: 400 }],
    });
    expect(created.status).toBe(201);
    invoiceId = created.body.invoice._id;
    expect(created.body.invoice.totals.total).toBe(400);
    expect(created.body.invoice.balance).toBe(400);

    await request(app).post(`/invoicing/${invoiceId}/send`).set('Authorization', `Bearer ${tokenA}`);
    const partial = await request(app).post(`/invoicing/${invoiceId}/pay`).set('Authorization', `Bearer ${tokenA}`).send({ amount: 150 });
    expect(partial.body.invoice.status).toBe('partial');
    expect(partial.body.invoice.balance).toBe(250);
    const paid = await request(app).post(`/invoicing/${invoiceId}/pay`).set('Authorization', `Bearer ${tokenA}`).send({ amount: 250 });
    expect(paid.body.invoice.status).toBe('paid');
    expect(paid.body.invoice.balance).toBe(0);
  });

  it('reports invoicing stats', async () => {
    const res = await request(app).get('/invoicing/stats').set('Authorization', `Bearer ${tokenA}`);
    expect(res.body.collected).toBeGreaterThanOrEqual(400);
  });

  it('runs the deal pipeline with stage moves + commission forecast', async () => {
    const created = await request(app).post('/deals').set('Authorization', `Bearer ${tokenA}`).send({
      title: 'Brickell condo', clientName: 'Carlos', value: 500000, commissionPct: 3, stage: 'offer',
    });
    expect(created.status).toBe(201);
    const dealId = created.body.deal._id;
    const moved = await request(app).patch(`/deals/${dealId}/stage`).set('Authorization', `Bearer ${tokenA}`).send({ stage: 'closed-won' });
    expect(moved.body.deal.stage).toBe('closed-won');
    const stats = await request(app).get('/deals/stats').set('Authorization', `Bearer ${tokenA}`);
    expect(stats.body.wonCommission).toBeGreaterThanOrEqual(15000); // 3% of 500k
  });

  it('records ledger entries and summarizes them', async () => {
    await request(app).post('/ledger').set('Authorization', `Bearer ${tokenA}`).send({ type: 'income', category: 'commission', amount: 12000, date: '2026-06-15' });
    await request(app).post('/ledger').set('Authorization', `Bearer ${tokenA}`).send({ type: 'expense', category: 'marketing', amount: 2000, date: '2026-06-20' });
    const res = await request(app).get('/ledger/summary').set('Authorization', `Bearer ${tokenA}`);
    expect(res.body.summary.totalIncome).toBeGreaterThanOrEqual(12000);
    expect(res.body.summary.net).toBe(res.body.summary.totalIncome - res.body.summary.totalExpense);
    expect(res.body.summary.byMonth.some((m: { month: string }) => m.month === '2026-06')).toBe(true);
  });

  it('creates a document and issues it for e-signature', async () => {
    const created = await request(app).post('/documents').set('Authorization', `Bearer ${tokenA}`).send({
      title: 'Listing Agreement', client: { name: 'Pat Seller' }, body: 'Agreement text here.', templateKey: 'listing-agreement',
    });
    expect(created.status).toBe(201);
    docId = created.body.document._id;
    const sent = await request(app).post(`/documents/${docId}/send`).set('Authorization', `Bearer ${tokenA}`);
    expect(sent.body.document.status).toBe('sent');
    docToken = sent.body.token;
    expect(docToken).toBeTruthy();
  });

  it('client portal: views + signs a document without auth', async () => {
    const view = await request(app).get(`/portal/document/${docToken}`); // no auth header
    expect(view.status).toBe(200);
    expect(view.body.doc.title).toBe('Listing Agreement');
    const signed = await request(app).post(`/portal/document/${docToken}/sign`).send({ signerName: 'Pat Seller', accept: true });
    expect(signed.body.status).toBe('signed');
    // owner sees it signed + locked
    const doc = await request(app).get(`/documents/${docId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(doc.body.document.status).toBe('signed');
    expect(doc.body.document.signature.name).toBe('Pat Seller');
  });

  it('client portal: views + accepts a shared quote without auth', async () => {
    const q = await request(app).post('/quotations').set('Authorization', `Bearer ${tokenA}`).send({
      title: 'Portal Proposal', client: { name: 'Web Client' }, lineItems: [{ description: 'Listing', quantity: 1, unitPrice: 1000 }],
    });
    const share = await request(app).post(`/quotations/${q.body.quote._id}/share`).set('Authorization', `Bearer ${tokenA}`);
    quoteToken = share.body.token;
    const view = await request(app).get(`/portal/quote/${quoteToken}`);
    expect(view.status).toBe(200);
    expect(view.body.doc.status).toBe('viewed'); // sent → viewed on open
    const accepted = await request(app).post(`/portal/quote/${quoteToken}/respond`).send({ accept: true });
    expect(accepted.body.status).toBe('accepted');
  });

  it('portal rejects unknown tokens', async () => {
    expect((await request(app).get('/portal/quote/not-a-real-token')).status).toBe(404);
  });

  it('converts an accepted quote into an invoice', async () => {
    const q = await request(app).post('/quotations').set('Authorization', `Bearer ${tokenA}`).send({
      title: 'Convert me', client: { name: 'Buyer' }, lineItems: [{ description: 'Fee', quantity: 2, unitPrice: 250 }],
    });
    const conv = await request(app).post(`/invoicing/from-quote/${q.body.quote._id}`).set('Authorization', `Bearer ${tokenA}`);
    expect(conv.status).toBe(201);
    expect(conv.body.invoice.totals.total).toBe(500);
    expect(conv.body.invoice.quoteId).toBe(q.body.quote._id);
  });

  it('gates the owner suite (fresh starter account is blocked)', async () => {
    const s = await request(app).post('/auth/signup').send({ accountName: 'OS Starter', name: 'Sam', email: `os${Date.now()}@test.io`, password: 'Passw0rd!123' });
    for (const path of ['/invoicing', '/deals', '/ledger', '/documents']) {
      const res = await request(app).post(path).set('Authorization', `Bearer ${s.body.accessToken}`).send({});
      expect(res.status, path).toBe(403);
    }
  });

  it('keeps owner-suite records tenant-scoped', async () => {
    expect((await request(app).get(`/invoicing/${invoiceId}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
  });
});

describe('RBAC — tenant roles & members', () => {
  let agentToken = '';
  let viewerToken = '';
  let agentMemberId = '';
  let agentEmail = '';
  let agentPw = '';

  it('owner can invite members with roles (agent, viewer)', async () => {
    agentEmail = `agent${Date.now()}@test.io`;
    const agent = await request(app).post('/members').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Aggie Agent', email: agentEmail, role: 'agent' });
    expect(agent.status).toBe(201);
    expect(agent.body.tempPassword).toBeTruthy();
    agentMemberId = agent.body.member._id;
    agentPw = agent.body.tempPassword;
    const login = await request(app).post('/auth/login').send({ email: agentEmail, password: agentPw });
    agentToken = login.body.accessToken;

    const viewer = await request(app).post('/members').set('Authorization', `Bearer ${tokenA}`).send({ name: 'Vera Viewer', email: `viewer${Date.now()}@test.io`, role: 'viewer' });
    const vlogin = await request(app).post('/auth/login').send({ email: viewer.body.member.email, password: viewer.body.tempPassword });
    viewerToken = vlogin.body.accessToken;
    expect(viewerToken).toBeTruthy();
  });

  it('agent cannot manage members (403) and cannot change plan', async () => {
    const invite = await request(app).post('/members').set('Authorization', `Bearer ${agentToken}`).send({ name: 'X', email: `x${Date.now()}@test.io`, role: 'agent' });
    expect(invite.status).toBe(403);
    const billing = await request(app).post('/billing/subscribe').set('Authorization', `Bearer ${agentToken}`).send({ plan: 'empire' });
    expect(billing.status).toBe(403);
  });

  it('agent CAN write business data (data:write)', async () => {
    const quote = await request(app).post('/quotations').set('Authorization', `Bearer ${agentToken}`).send({ title: 'Agent quote', client: { name: 'C' }, lineItems: [{ description: 'x', quantity: 1, unitPrice: 100 }] });
    expect(quote.status).toBe(201);
  });

  it('viewer is read-only: can GET but not mutate', async () => {
    expect((await request(app).get('/quotations').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(200);
    const write = await request(app).post('/quotations').set('Authorization', `Bearer ${viewerToken}`).send({ title: 'nope', client: { name: 'C' }, lineItems: [{ description: 'x', quantity: 1, unitPrice: 1 }] });
    expect(write.status).toBe(403);
    expect(write.body.need).toBe('data:write');
    // read-only on leads + deals too
    expect((await request(app).post('/deals').set('Authorization', `Bearer ${viewerToken}`).send({ title: 'x', clientName: 'y' })).status).toBe(403);
  });

  it('admin can manage agents but cannot mint another admin (only owner can)', async () => {
    // Owner promotes the agent to admin.
    const promote = await request(app).patch(`/members/${agentMemberId}`).set('Authorization', `Bearer ${tokenA}`).send({ role: 'admin' });
    expect(promote.body.member.role).toBe('admin');
    // Re-login so the token carries the new 'admin' role.
    const adminLogin = await request(app).post('/auth/login').send({ email: agentEmail, password: agentPw });
    const adminToken = adminLogin.body.accessToken;
    expect(adminLogin.body.user.role).toBe('admin');
    // Admin CAN create an agent...
    const okAgent = await request(app).post('/members').set('Authorization', `Bearer ${adminToken}`).send({ name: 'New Agent', email: `na${Date.now()}@test.io`, role: 'agent' });
    expect(okAgent.status).toBe(201);
    // ...but NOT another admin (only owner can touch owner/admin roles).
    const noAdmin = await request(app).post('/members').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Yara Admin', email: `y${Date.now()}@test.io`, role: 'admin' });
    expect(noAdmin.status).toBe(403);
  });

  it('keeps members tenant-scoped', async () => {
    const listB = await request(app).get('/members').set('Authorization', `Bearer ${tokenB}`);
    expect(listB.body.members.some((m: { _id: string }) => m._id === agentMemberId)).toBe(false);
  });
});

describe('super admin (platform)', () => {
  let superToken = '';

  it('non-superadmin is blocked from /admin (403)', async () => {
    expect((await request(app).get('/admin/accounts').set('Authorization', `Bearer ${tokenA}`)).status).toBe(403);
    expect((await request(app).get('/admin/stats').set('Authorization', `Bearer ${tokenA}`)).status).toBe(403);
  });

  it('a superadmin can list all tenants and see platform stats', async () => {
    // Promote tenant A's owner to platform superadmin directly, then re-login.
    const { User } = await import('../src/models.js');
    await User.updateOne({ email: 'a@test.io' }, { $set: { platformRole: 'superadmin' } });
    const login = await request(app).post('/auth/login').send({ email: 'a@test.io', password: 'Passw0rd!123' });
    superToken = login.body.accessToken;
    expect(login.body.user.platformRole).toBe('superadmin');

    const accounts = await request(app).get('/admin/accounts').set('Authorization', `Bearer ${superToken}`);
    expect(accounts.status).toBe(200);
    expect(accounts.body.accounts.length).toBeGreaterThanOrEqual(2); // A and B at least
    const stats = await request(app).get('/admin/stats').set('Authorization', `Bearer ${superToken}`);
    expect(stats.body.totalAccounts).toBeGreaterThanOrEqual(2);
    expect(stats.body.estMrr).toBeGreaterThan(0);
  });

  it('a superadmin can change a tenant plan and suspend/unsuspend it', async () => {
    const patched = await request(app).patch(`/admin/accounts/${accountBId}`).set('Authorization', `Bearer ${superToken}`).send({ plan: 'empire' });
    expect(patched.body.account.plan).toBe('empire');
    expect(patched.body.account.enabledModules).toContain('leadEngine');
    // suspend → the tenant's owner can no longer log in
    await request(app).patch(`/admin/accounts/${accountBId}`).set('Authorization', `Bearer ${superToken}`).send({ status: 'suspended' });
    const blocked = await request(app).post('/auth/login').send({ email: 'b@test.io', password: 'Passw0rd!123' });
    expect(blocked.status).toBe(403);
    // reactivate so later state is clean
    await request(app).patch(`/admin/accounts/${accountBId}`).set('Authorization', `Bearer ${superToken}`).send({ status: 'active' });
  });

  it('impersonation issues a working, tenant-scoped token (no admin access)', async () => {
    const imp = await request(app).post(`/admin/accounts/${accountBId}/impersonate`).set('Authorization', `Bearer ${superToken}`);
    expect(imp.status).toBe(200);
    expect(imp.body.accessToken).toBeTruthy();
    // the impersonation token works for that tenant...
    const me = await request(app).get('/account/me').set('Authorization', `Bearer ${imp.body.accessToken}`);
    expect(me.body.account._id).toBe(accountBId);
    // ...but does NOT carry superadmin (cannot reach /admin)
    expect((await request(app).get('/admin/accounts').set('Authorization', `Bearer ${imp.body.accessToken}`)).status).toBe(403);
  });
});

describe('CMS', () => {
  let pageId = '';
  const siteSlug = `a-site-${Date.now()}`;

  it('saves site settings', async () => {
    const res = await request(app).put('/cms/settings').set('Authorization', `Bearer ${tokenA}`).send({ brandName: 'A Realty', tagline: 'We sell homes', theme: { accentColor: '#1F9D6B' }, published: true });
    expect(res.status).toBe(200);
    expect(res.body.config.brandName).toBe('A Realty');
  });

  it('creates a page with an auto slug and blocks', async () => {
    const res = await request(app).post('/cms').set('Authorization', `Bearer ${tokenA}`).send({
      type: 'page', title: 'About Us', status: 'published', isHome: true, showInNav: true,
      blocks: [{ type: 'hero', data: { heading: 'Welcome' } }, { type: 'contact', data: {} }],
    });
    expect(res.status).toBe(201);
    pageId = res.body.content._id;
    expect(res.body.content.slug).toBe('about-us');
  });

  it('enforces unique slugs per type', async () => {
    const res = await request(app).post('/cms').set('Authorization', `Bearer ${tokenA}`).send({ type: 'page', title: 'About Us' });
    expect(res.body.content.slug).toBe('about-us-2');
  });

  it('exposes the block-type registry', async () => {
    const res = await request(app).get('/cms/blocks').set('Authorization', `Bearer ${tokenA}`);
    expect(res.body.blockTypes.some((b: { type: string }) => b.type === 'hero')).toBe(true);
    expect(res.body.blockTypes.some((b: { type: string }) => b.type === 'contact')).toBe(true);
  });

  it('renders the public site by websiteSlug (published only, counts views)', async () => {
    const { Account } = await import('../src/models.js');
    await Account.updateOne({ _id: accountAId }, { $set: { websiteSlug: siteSlug } });
    const idx = await request(app).get(`/public-cms/${siteSlug}`); // no auth
    expect(idx.status).toBe(200);
    expect(idx.body.config.brandName).toBe('A Realty');
    expect(idx.body.home?.title).toBe('About Us');
    expect(idx.body.pages.some((p: { slug: string }) => p.slug === 'about-us')).toBe(true);
    const content = await request(app).get(`/public-cms/${siteSlug}/content/about-us`);
    expect(content.status).toBe(200);
    expect(content.body.content.blocks.length).toBe(2);
  });

  it('does not serve draft content publicly', async () => {
    await request(app).post('/cms').set('Authorization', `Bearer ${tokenA}`).send({ type: 'post', title: 'Hidden Draft', status: 'draft' });
    expect((await request(app).get(`/public-cms/${siteSlug}/content/hidden-draft`)).status).toBe(404);
  });

  it('publish / unpublish toggles public visibility', async () => {
    const created = await request(app).post('/cms').set('Authorization', `Bearer ${tokenA}`).send({ type: 'post', title: 'Toggle Me', status: 'draft' });
    const id = created.body.content._id;
    await request(app).post(`/cms/${id}/publish`).set('Authorization', `Bearer ${tokenA}`);
    expect((await request(app).get(`/public-cms/${siteSlug}/content/toggle-me`)).status).toBe(200);
    await request(app).post(`/cms/${id}/unpublish`).set('Authorization', `Bearer ${tokenA}`);
    expect((await request(app).get(`/public-cms/${siteSlug}/content/toggle-me`)).status).toBe(404);
  });

  it('gates the module (fresh starter account is blocked)', async () => {
    const s = await request(app).post('/auth/signup').send({ accountName: 'CMS Starter', name: 'Cee', email: `cms${Date.now()}@test.io`, password: 'Passw0rd!123' });
    expect((await request(app).get('/cms').set('Authorization', `Bearer ${s.body.accessToken}`)).status).toBe(403);
  });

  it('keeps CMS content tenant-scoped', async () => {
    expect((await request(app).get(`/cms/${pageId}`).set('Authorization', `Bearer ${tokenB}`)).status).toBe(404);
  });

  it('validates content input (Zod)', async () => {
    const res = await request(app).post('/cms').set('Authorization', `Bearer ${tokenA}`).send({ type: 'page' });
    expect(res.status).toBe(400);
  });
});

describe('compliance', () => {
  it('blocks outbound to DNC numbers', async () => {
    await request(app)
      .patch('/account/compliance')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ addDnc: '+13055558899' });
    const hook = await request(app)
      .post(`/webhook/lead/${accountAId}`)
      .send({ firstName: 'Blocked', phone: '+13055558899' });
    await sleep(1500);
    const lead = await request(app).get(`/leads/${hook.body.leadId}`).set('Authorization', `Bearer ${tokenA}`);
    expect(lead.body.lead.firstResponseSeconds).toBeUndefined();
  });
});
