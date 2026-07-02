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
const { closeQueue } = await import('../src/lib/queue.js');

let app: Express;
let tokenA = '';
let tokenB = '';
let accountAId = '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await connectDb();
  registerInstantReplyWorker();
  registerVoiceCallWorker();
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
