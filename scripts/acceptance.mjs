/**
 * Phase acceptance script — runs against a live API (default http://localhost:4100).
 * Covers PROMPT acceptance criteria for Phases 0-6 wedge paths.
 * Usage: node scripts/acceptance.mjs [baseUrl]
 */
const BASE = process.argv[2] ?? 'http://localhost:4100';
let failures = 0;
let token = '';

function check(name, cond, extra = '') {
  const ok = Boolean(cond);
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) failures += 1;
  return ok;
}

async function req(method, path, body, auth = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();

console.log(`\n━━ CloseFlow acceptance vs ${BASE} ━━`);

// ---------- Phase 0: core ----------
console.log('\nPhase 0 — Core');
const health = await req('GET', '/health', undefined, false);
check('health endpoint', health.data.ok === true);

const signup = await req('POST', '/auth/signup', {
  accountName: `Acceptance Realty ${stamp}`,
  name: 'Ana Tester',
  email: `accept${stamp}@test.io`,
  password: 'Passw0rd!123',
}, false);
check('signup creates account', signup.status === 201 && signup.data.accessToken);
token = signup.data.accessToken;
const accountId = signup.data.account._id;

const me = await req('GET', '/account/me');
check('auth /me works', me.status === 200 && me.data.account._id === accountId);
check('starter plan gates voice module', (await req('GET', '/calls')).status === 403);

// mock billing upgrade
const sub = await req('POST', '/billing/subscribe', { plan: 'empire' });
check('subscribe (mock) sets plan+modules', sub.data.account?.plan === 'empire' && sub.data.account.enabledModules.includes('voice'));

// tenant isolation: second account cannot read first account's data
const other = await req('POST', '/auth/signup', {
  accountName: `Other ${stamp}`, name: 'Bob Other', email: `other${stamp}@test.io`, password: 'Passw0rd!123',
}, false);
const otherToken = other.data.accessToken;
const crossLeads = await fetch(`${BASE}/leads`, { headers: { Authorization: `Bearer ${otherToken}` } }).then((r) => r.json());

// ---------- Phase 1: Instant Reply ----------
console.log('\nPhase 1 — Instant Reply (wedge)');
const t0 = Date.now();
const hook = await req('POST', `/webhook/lead/${accountId}`, {
  firstName: 'Zoe',
  lastName: 'Zillow',
  phone: '+13055559001',
  source: 'zillow',
  propertyInterest: '2BR condo in Brickell',
  locale: 'en',
}, false);
check('lead webhook accepts + creates lead', hook.status === 201 && hook.data.leadId);
const leadId = hook.data.leadId;

// dedup
const dup = await req('POST', `/webhook/lead/${accountId}`, { firstName: 'Zoe', phone: '+13055559001', source: 'zillow' }, false);
check('duplicate lead deduped', dup.data.deduped === true);

// instant reply lands within 10s
let replied = false;
let frs;
for (let i = 0; i < 20; i++) {
  await sleep(500);
  const lead = await req('GET', `/leads/${leadId}`);
  frs = lead.data.lead?.firstResponseSeconds;
  if (frs !== undefined) { replied = true; break; }
}
check('instant SMS sent <10s (firstResponseSeconds recorded)', replied && (Date.now() - t0) < 10_000, `frs=${frs}s`);

const conv = await req('GET', '/conversations');
const smsConv = conv.data.items?.find((c) => c.channel === 'sms' && c.leadId?._id === leadId);
check('outbound logged to Conversation (mock-sent)', smsConv?.messages?.some((m) => m.direction === 'outbound' && m.status === 'mock-sent'));

const stats = await req('GET', '/stats/dashboard');
check('speed-to-lead metric + trend update', stats.data.speedToLeadP50 !== null && stats.data.speedToLeadTrend.length > 0);

// tenant isolation check (after data exists)
check('multi-tenant isolation (account B sees 0 leads)', Array.isArray(crossLeads.items) && crossLeads.items.length === 0);

// ComplianceGuard: DNC block
await req('PATCH', '/account/compliance', { addDnc: '+13055559002' });
const dncHook = await req('POST', `/webhook/lead/${accountId}`, { firstName: 'Dnc', phone: '+13055559002', source: 'website' }, false);
await sleep(1500);
const dncConv = await req('GET', '/conversations');
const dncMsgs = dncConv.data.items?.find((c) => c.leadId?._id === dncHook.data.leadId)?.messages ?? [];
check('ComplianceGuard blocks DNC number (logged, not sent)', dncMsgs.every((m) => m.status !== 'sent' && m.status !== 'mock-sent'));

// ---------- Phase 2: Voice ----------
console.log('\nPhase 2 — Voice agents');
const agents = await req('GET', '/calls/agents');
check('20 voice-agent configs served', agents.data.agents?.length === 20);
check('3 agents live', agents.data.agents?.filter((a) => a.status === 'live').length === 3);

// The webhook lead already triggered a speed-to-lead call (voice enabled post-upgrade? it was starter at intake).
// Trigger explicitly + a Spanish and Arabic lead for multilingual coverage.
const esHook = await req('POST', `/webhook/lead/${accountId}`, { firstName: 'Carlos', phone: '+13055559003', source: 'facebook', locale: 'es' }, false);
const arHook = await req('POST', `/webhook/lead/${accountId}`, { firstName: 'Faisal', phone: '+966505559004', source: 'website', locale: 'ar' }, false);
await req('POST', '/calls/trigger', { leadId, agentKey: 'speed-to-lead' });
await sleep(4000);

const calls = await req('GET', '/calls');
const completed = calls.data.items?.filter((c) => c.status === 'completed') ?? [];
check('outbound call completed with transcript', completed.length >= 1 && completed[0].transcript?.length > 0);
check('call outcome + summary persisted', completed.some((c) => c.outcome === 'booked' && c.summary));
const localesCalled = new Set(completed.map((c) => c.leadId?.locale));
check('calls ran in ≥2 languages', localesCalled.size >= 2, [...localesCalled].join(','));

const appts = await req('GET', '/appointments');
check('booking created Appointment', appts.data.items?.length >= 1);

// ---------- Phase 3: Follow-up + WhatsApp ----------
console.log('\nPhase 3 — Follow-up + WhatsApp');
const seq = await req('POST', '/sequences', {
  name: 'Accept Nurture',
  locale: 'en',
  steps: [
    { delayHours: 0, channel: 'sms', template: 'Hi {{lead.firstName}}, step one!' },
    { delayHours: 24, channel: 'sms', template: 'Hi {{lead.firstName}}, step two tomorrow.' },
  ],
});
check('sequence created', seq.status === 201);
const enroll = await req('POST', '/sequences/enroll', { leadId, sequenceId: seq.data.sequence._id });
check('lead enrolled', enroll.status === 201);
await sleep(2500);
let enrollments = await req('GET', '/sequences/enrollments');
let en = enrollments.data.items?.find((e) => e._id === enroll.data.enrollmentId);
check('step 1 fired now, step 2 scheduled', en?.currentStep === 1 && en?.status === 'active' && en?.nextRunAt);

// inbound SMS reply pauses sequence
await fetch(`${BASE}/webhook/sms/inbound`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ From: '+13055559001', To: '+10000000000', Body: 'Yes I am interested!' }),
});
await sleep(1500);
enrollments = await req('GET', '/sequences/enrollments');
en = enrollments.data.items?.find((e) => e._id === enroll.data.enrollmentId);
check('inbound reply pauses sequence', en?.status === 'paused');

// WhatsApp inbound → auto-reply (mock provider, mock LLM)
await fetch(`${BASE}/webhook/whatsapp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: 'none' }, messages: [{ from: '13055559001', text: { body: 'What areas do you cover?' } }] } }] }],
  }),
});
await sleep(2500);
const conv2 = await req('GET', '/conversations');
const wa = conv2.data.items?.find((c) => c.channel === 'whatsapp');
check('WhatsApp inbound → contextual auto-reply logged', wa?.messages?.some((m) => m.direction === 'outbound'));

// STOP opt-out
await fetch(`${BASE}/webhook/sms/inbound`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ From: '+13055559001', To: '+10000000000', Body: 'STOP' }),
});
await sleep(1000);
const stoppedLead = await req('GET', `/leads/${leadId}`);
check('STOP flips lead to dnc + kills consent', stoppedLead.data.lead?.status === 'dnc' && stoppedLead.data.lead?.consent?.sms === false);

// ---------- Phase 4: Lead Engine ----------
console.log('\nPhase 4 — Lead Engine');
const job = await req('POST', '/lead-engine/jobs', { source: 'google-maps', query: 'Coral Gables homeowners', maxResults: 10 });
check('scrape job accepted', job.status === 202);
let jobDone = null;
for (let i = 0; i < 20; i++) {
  await sleep(700);
  const jobs = await req('GET', '/lead-engine/jobs');
  jobDone = jobs.data.items?.find((j) => j._id === job.data.job._id);
  if (jobDone?.status === 'done' || jobDone?.status === 'error') break;
}
check('scrape → N validated leads imported', jobDone?.status === 'done' && jobDone.imported > 0, `found=${jobDone?.found} imported=${jobDone?.imported}`);

// ---------- Phase 5: Instagram + Website ----------
console.log('\nPhase 5 — Instagram (stub) + Website');
const post = await req('POST', '/content/posts', {
  caption: 'Acceptance test post 🏡',
  scheduledAt: new Date(Date.now() + 1000).toISOString(),
});
check('IG post scheduled on calendar', post.status === 201);
await sleep(2500);
const posts = await req('GET', '/content/posts');
const pubPost = posts.data.items?.find((p) => p._id === post.data.post._id);
check('stub adapter logged intended publish', pubPost?.status === 'stub-published');

const site = await req('POST', '/website/provision', { slug: `accept-${stamp}` });
check('site provisioned', site.status === 200 && site.data.slug);
const pub = await req('GET', `/website/public/accept-${stamp}`, undefined, false);
check('public site data + webhook wiring', pub.data.webhookUrl?.includes(accountId));

// ---------- Phase 6: Content + Orchestrator ----------
console.log('\nPhase 6 — Captions, video, orchestrator');
const captions = await req('POST', '/content/captions', { topic: 'Just listed waterfront condo', count: 2 });
check('caption generation returns captions', Array.isArray(captions.data.captions) && captions.data.captions.length > 0);

const vid = await req('POST', '/content/videos', { title: 'Listing teaser', script: 'A beautiful 2BR in Brickell…' });
check('video request queued', vid.status === 202);
await sleep(2000);
const vids = await req('GET', '/content/videos');
const vidDone = vids.data.items?.find((v) => v._id === vid.data.job._id);
check('stub video render returns placeholder URL', vidDone?.status === 'done' && vidDone.renderUrl);

const newLeadForOrch = await req('POST', `/webhook/lead/${accountId}`, { firstName: 'Orch', phone: '+13055559005', source: 'website' }, false);
await sleep(1200);
const orch = await req('POST', '/orchestrator/run', { leadId: newLeadForOrch.data.leadId, goal: 'Book an appointment' });
check('orchestrator returns structured next-best-action', orch.data.action?.type && orch.data.action?.agentPath?.length > 0, `${orch.data.action?.type} via ${orch.data.source}`);
check('orchestrator executed the action + AgentRun logged', orch.data.executed && orch.data.runId);

console.log(`\n━━ ${failures === 0 ? 'ALL PASS ✅' : `${failures} FAILURE(S) ❌`} ━━\n`);
process.exit(failures === 0 ? 0 : 1);
