import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// Force every provider into mock mode + ephemeral in-memory Mongo (isolated per file).
process.env.FORCE_MOCK_PROVIDERS = '1';
process.env.COMPLIANCE_IGNORE_QUIET_HOURS = '1';
process.env.MONGO_URI = '';
process.env.REDIS_URL = '';

const { connectDb, disconnectDb } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { registerContentWorkers } = await import('../src/workers/content.js');
const { registerAdWorkers } = await import('../src/workers/ads.js');
const { closeQueue } = await import('../src/lib/queue.js');

let app: Express;
let tokenA = '';
let tokenB = '';
let tokenStarter = '';
let accountAId = '';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  await connectDb();
  registerContentWorkers();
  registerAdWorkers();
  app = createApp();

  const a = await request(app).post('/auth/signup').send({
    accountName: 'Studio A', name: 'Ana A', email: 'studio-a@test.io', password: 'Passw0rd!123',
  });
  tokenA = a.body.accessToken;
  accountAId = a.body.account._id;
  const b = await request(app).post('/auth/signup').send({
    accountName: 'Studio B', name: 'Ben B', email: 'studio-b@test.io', password: 'Passw0rd!123',
  });
  tokenB = b.body.accessToken;
  const c = await request(app).post('/auth/signup').send({
    accountName: 'Starter C', name: 'Cara C', email: 'studio-c@test.io', password: 'Passw0rd!123',
  });
  tokenStarter = c.body.accessToken;

  // A + B on Ultimate (unlocks content + ads + instagram); C stays on starter.
  await request(app).post('/billing/subscribe').set(auth(tokenA)).send({ plan: 'ultimate' });
  await request(app).post('/billing/subscribe').set(auth(tokenB)).send({ plan: 'ultimate' });
}, 120_000);

afterAll(async () => {
  await closeQueue();
  await disconnectDb();
});

describe('content studio — module gating', () => {
  it('starter plan is blocked from the studio + ads + research', async () => {
    for (const path of ['/content/overview', '/content/calendar', '/content/media', '/content/connections']) {
      const res = await request(app).get(path).set(auth(tokenStarter));
      expect(res.status, path).toBe(403);
      expect(res.body.error).toBe('module_not_enabled');
    }
    // ads-gated
    expect((await request(app).get('/content/ads').set(auth(tokenStarter))).status).toBe(403);
    expect((await request(app).get('/content/research').set(auth(tokenStarter))).status).toBe(403);
  });

  it('unauthenticated requests are rejected', async () => {
    expect((await request(app).get('/content/overview')).status).toBe(401);
  });
});

describe('content studio — AI generation', () => {
  it('generates structured post variants (hook/caption/hashtags/cta) with provider info', async () => {
    const res = await request(app).post('/content/generate').set(auth(tokenA)).send({
      topic: 'Just listed 3BR waterfront condo in Brickell', platform: 'instagram', format: 'feed-square',
      tone: 'luxury', goal: 'leads', variants: 3,
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.posts)).toBe(true);
    expect(res.body.posts.length).toBeGreaterThan(0);
    const p = res.body.posts[0];
    expect(typeof p.caption).toBe('string');
    expect(p.caption.length).toBeGreaterThan(0);
    expect(Array.isArray(p.hashtags)).toBe(true);
    expect(res.body.provider).toBeTruthy();
  });

  it('legacy caption endpoint still works', async () => {
    const res = await request(app).post('/content/captions').set(auth(tokenA)).send({ topic: 'Open house Saturday', count: 2 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.captions)).toBe(true);
  });

  it('validates generation input (Zod)', async () => {
    const res = await request(app).post('/content/generate').set(auth(tokenA)).send({ topic: 'x' });
    expect(res.status).toBe(400);
  });

  it('generates a placeholder image asset (labeled stub)', async () => {
    const res = await request(app).post('/content/generate-image').set(auth(tokenA))
      .send({ prompt: 'Sunlit modern kitchen with marble island', aspect: '4:5', style: 'luxury' });
    expect(res.status).toBe(201);
    expect(res.body.asset.kind).toBe('image');
    expect(res.body.asset.stub).toBe(true);
    expect(res.body.asset.aspect).toBe('4:5');
  });
});

describe('content studio — media library', () => {
  let assetId = '';
  it('adds media by URL and lists it', async () => {
    const create = await request(app).post('/content/media').set(auth(tokenA)).send({
      name: 'Brickell hero', kind: 'image', url: 'https://placehold.co/1080x1080/D2ECDB/1A1A1A?text=Listing',
      source: 'url', aspect: '1:1',
    });
    expect(create.status).toBe(201);
    assetId = create.body.asset._id;
    const list = await request(app).get('/content/media').set(auth(tokenA));
    expect(list.status).toBe(200);
    expect(list.body.items.some((m: { _id: string }) => m._id === assetId)).toBe(true);
    expect(list.body.provider).toBeTruthy();
  });

  it('stores an uploaded (base64) asset via the mock storage adapter', async () => {
    const res = await request(app).post('/content/media').set(auth(tokenA)).send({
      name: 'upload.jpg', kind: 'image', dataBase64: Buffer.from('fake-image-bytes').toString('base64'),
      contentType: 'image/jpeg', source: 'upload', width: 1080, height: 1080,
    });
    expect(res.status).toBe(201);
    expect(res.body.asset.stub).toBe(true); // mock storage → inline data URL
    expect(res.body.asset.url.startsWith('data:image/jpeg')).toBe(true);
  });

  it('rejects media with neither url nor upload', async () => {
    const res = await request(app).post('/content/media').set(auth(tokenA)).send({ name: 'x', kind: 'image' });
    expect(res.status).toBe(400);
  });

  it('deletes an asset', async () => {
    expect((await request(app).delete(`/content/media/${assetId}`).set(auth(tokenA))).status).toBe(200);
    const list = await request(app).get('/content/media').set(auth(tokenA));
    expect(list.body.items.some((m: { _id: string }) => m._id === assetId)).toBe(false);
  });
});

describe('content studio — connections', () => {
  it('lists all five platforms with honest live/mock status', async () => {
    const res = await request(app).get('/content/connections').set(auth(tokenA));
    expect(res.status).toBe(200);
    const platforms = res.body.items.map((i: { platform: string }) => i.platform).sort();
    expect(platforms).toEqual(['facebook', 'instagram', 'linkedin', 'tiktok', 'youtube']);
    // In mock mode every platform is not-live and carries a reason.
    for (const item of res.body.items) {
      expect(item.live).toBe(false);
      expect(typeof item.reason).toBe('string');
    }
  });

  it('connect then disconnect a platform', async () => {
    const con = await request(app).post('/content/connections').set(auth(tokenA)).send({ platform: 'instagram' });
    expect(con.status).toBe(200);
    expect(['connected', 'pending']).toContain(con.body.connection.status);
    const after = await request(app).get('/content/connections').set(auth(tokenA));
    expect(after.body.items.find((i: { platform: string }) => i.platform === 'instagram').status).not.toBe('disconnected');
    expect((await request(app).delete('/content/connections/instagram').set(auth(tokenA))).status).toBe(200);
  });
});

describe('content studio — compose + publish pipeline', () => {
  it('publishes now to multiple platforms → per-platform stub results', async () => {
    const res = await request(app).post('/content/compose').set(auth(tokenA)).send({
      platforms: ['instagram', 'facebook'], format: 'feed-square', caption: 'Waterfront living 🌊 #Brickell',
      publishNow: true, mediaUrls: ['https://placehold.co/1080x1080'],
    });
    expect(res.status).toBe(201);
    const postId = res.body.post._id;
    await sleep(1500); // let the content-publish worker run
    const cal = await request(app).get('/content/calendar').set(auth(tokenA));
    const post = cal.body.items.find((p: { _id: string }) => p._id === postId);
    expect(post).toBeTruthy();
    expect(post.status).toBe('stub-published');
    expect(post.results).toHaveLength(2);
    const platforms = post.results.map((r: { platform: string }) => r.platform).sort();
    expect(platforms).toEqual(['facebook', 'instagram']);
    for (const r of post.results) expect(r.status).toBe('mock-sent');
  });

  it('schedules a future post (stays scheduled)', async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    const res = await request(app).post('/content/compose').set(auth(tokenA)).send({
      platforms: ['instagram'], format: 'reel', caption: 'Coming soon', scheduledAt: when,
    });
    expect(res.status).toBe(201);
    expect(res.body.post.status).toBe('scheduled');
  });

  it('requires a schedule time unless publishNow', async () => {
    const res = await request(app).post('/content/compose').set(auth(tokenA)).send({
      platforms: ['instagram'], caption: 'no time', format: 'feed-square',
    });
    expect(res.status).toBe(400);
  });
});

describe('content studio — ads manager', () => {
  let campaignId = '';
  it('creates + launches a campaign, then syncs synthetic insights', async () => {
    const res = await request(app).post('/content/ads').set(auth(tokenA)).send({
      name: 'Brickell Open House', objective: 'LEADS', platform: 'meta', budgetDaily: 30, durationDays: 7,
      creative: { headline: 'Waterfront 3BR — Open Sat', primaryText: 'Tour a stunning Brickell condo.', cta: 'BOOK_NOW' },
      targeting: { geo: { radiusKm: 16, cities: ['Miami'], country: 'US' }, ageMin: 30, ageMax: 60, genders: ['all'], interests: ['Real estate'] },
    });
    expect(res.status).toBe(201);
    campaignId = res.body.campaign._id;
    await sleep(2000); // adLaunch → adSync
    const list = await request(app).get('/content/ads').set(auth(tokenA));
    const c = list.body.items.find((x: { _id: string }) => x._id === campaignId);
    expect(c).toBeTruthy();
    expect(c.status).toBe('active'); // mock launch → active
    expect(c.stub).toBe(true);
    expect(c.metrics.impressions).toBeGreaterThan(0);
    expect(c.metrics.leads).toBeGreaterThan(0);
    expect(c.metrics.daily).toHaveLength(7);
  });

  it('pauses and resumes a campaign', async () => {
    expect((await request(app).post(`/content/ads/${campaignId}/status`).set(auth(tokenA)).send({ status: 'paused' })).body.campaign.status).toBe('paused');
    expect((await request(app).post(`/content/ads/${campaignId}/status`).set(auth(tokenA)).send({ status: 'active' })).body.campaign.status).toBe('active');
  });

  it('validates campaign input (Zod)', async () => {
    expect((await request(app).post('/content/ads').set(auth(tokenA)).send({ name: 'x' })).status).toBe(400);
  });
});

describe('content studio — market research (Meta Ad Library)', () => {
  let researchId = '';
  let adId = '';
  it('runs a competitor search and persists labeled sample ads', async () => {
    const res = await request(app).post('/content/research').set(auth(tokenA)).send({
      query: 'Miami luxury condos', region: 'US', platform: 'all', count: 6, activeStatus: 'active',
    });
    expect(res.status).toBe(201);
    expect(res.body.stub).toBe(true);
    expect(res.body.items.length).toBe(6);
    researchId = res.body.run._id;
    adId = res.body.items[0]._id;
    expect(typeof res.body.items[0].angle).toBe('string');
    expect(res.body.items[0].advertiser).toContain('[SAMPLE]');
  });

  it('lists runs and fetches a run\'s ads', async () => {
    const list = await request(app).get('/content/research').set(auth(tokenA));
    expect(list.body.runs.some((r: { _id: string }) => r._id === researchId)).toBe(true);
    const ads = await request(app).get(`/content/research/${researchId}/ads`).set(auth(tokenA));
    expect(ads.body.items.length).toBe(6);
  });

  it('toggles an ad onto the watchlist', async () => {
    const watch = await request(app).post(`/content/research/ads/${adId}/watch`).set(auth(tokenA)).send({ watched: true });
    expect(watch.status).toBe(200);
    expect(watch.body.ad.watched).toBe(true);
    const list = await request(app).get('/content/research').set(auth(tokenA));
    expect(list.body.watched.some((a: { _id: string }) => a._id === adId)).toBe(true);
  });
});

describe('content studio — overview', () => {
  it('returns aggregate stats, cadence and platform mix', async () => {
    const res = await request(app).get('/content/overview').set(auth(tokenA));
    expect(res.status).toBe(200);
    expect(res.body.stats).toBeTruthy();
    for (const k of ['scheduled', 'published', 'activeCampaigns', 'mediaCount', 'connections', 'totalSpend', 'totalLeads', 'watchedCount']) {
      expect(typeof res.body.stats[k]).toBe('number');
    }
    expect(res.body.cadence).toHaveLength(7);
    expect(res.body.stats.activeCampaigns).toBeGreaterThan(0); // launched above
    expect(Array.isArray(res.body.mix)).toBe(true);
  });
});

describe('content studio — tenant isolation', () => {
  it('B never sees A\'s media, campaigns, posts or research', async () => {
    // A created media/campaign/posts/research above; B (also ultimate) sees none of it.
    const media = await request(app).get('/content/media').set(auth(tokenB));
    expect(media.body.items).toHaveLength(0);
    const ads = await request(app).get('/content/ads').set(auth(tokenB));
    expect(ads.body.items).toHaveLength(0);
    const research = await request(app).get('/content/research').set(auth(tokenB));
    expect(research.body.runs).toHaveLength(0);
    const cal = await request(app).get('/content/calendar').set(auth(tokenB));
    expect(cal.body.items).toHaveLength(0);
    const overview = await request(app).get('/content/overview').set(auth(tokenB));
    expect(overview.body.stats.mediaCount).toBe(0);
    expect(overview.body.stats.activeCampaigns).toBe(0);
  });
});
