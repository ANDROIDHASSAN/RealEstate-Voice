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
const { closeQueue } = await import('../src/lib/queue.js');

let app: Express;
let tokenA = '';
let tokenB = '';
let accountAId = '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  await connectDb();
  registerInstantReplyWorker();
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
