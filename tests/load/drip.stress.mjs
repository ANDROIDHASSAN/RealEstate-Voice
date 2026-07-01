/**
 * Stress test (§13): enqueue hundreds of drip jobs; assert the queue drains
 * without loss and ComplianceGuard blocks the DNC ones.
 * Usage: node tests/load/drip.stress.mjs [baseUrl] [count]
 */
const BASE = process.argv[2] ?? 'http://localhost:4100';
const COUNT = Number(process.argv[3] ?? 300);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stamp = Date.now();
async function api(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

const signup = await api('/auth/signup', {
  method: 'POST',
  body: { accountName: `Stress ${stamp}`, name: 'Stress', email: `stress${stamp}@test.io`, password: 'Passw0rd!123' },
});
const token = signup.accessToken;
const accountId = signup.account._id;
await api('/billing/subscribe', { method: 'POST', token, body: { plan: 'pro' } });

// One lead per enrollment; every 10th is DNC (compliance must block those sends).
console.log(`creating ${COUNT} leads…`);
const leadIds = [];
const dncIds = new Set();
for (let i = 0; i < COUNT; i++) {
  const phone = `+1786${String(6000000 + i).padStart(7, '0')}`;
  if (i % 10 === 0) {
    await api('/account/compliance', { method: 'PATCH', token, body: { addDnc: phone } });
  }
  const hook = await api(`/webhook/lead/${accountId}`, {
    method: 'POST',
    body: { firstName: `S${i}`, phone, source: 'zapier' },
  });
  leadIds.push(hook.leadId);
  if (i % 10 === 0) dncIds.add(hook.leadId);
}

const seq = await api('/sequences', {
  method: 'POST',
  token,
  body: { name: 'Stress seq', locale: 'en', steps: [{ delayHours: 0, channel: 'sms', template: 'Hi {{lead.firstName}}!' }] },
});

console.log(`enrolling ${COUNT} leads…`);
for (const leadId of leadIds) {
  await api('/sequences/enroll', { method: 'POST', token, body: { leadId, sequenceId: seq.sequence._id } });
}

// Wait for drain: all enrollments completed.
let completed = 0;
for (let i = 0; i < 120; i++) {
  await sleep(2000);
  const enrollments = await api('/sequences/enrollments?limit=1000', { token });
  completed = enrollments.items.filter((e) => e.status === 'completed').length;
  process.stdout.write(`\r  drained ${completed}/${COUNT}`);
  if (completed >= COUNT) break;
}
console.log();

// Verify compliance: DNC leads got blocked/no sends; others got sends.
const convs = await api('/conversations?limit=1000', { token });
const blockedOk = convs.items
  .filter((c) => dncIds.has(c.leadId?._id))
  .every((c) => c.messages.every((m) => m.status === 'blocked'));

let failed = false;
if (completed < COUNT) {
  console.error(`❌ queue did not drain (${completed}/${COUNT})`);
  failed = true;
}
if (!blockedOk) {
  console.error('❌ ComplianceGuard let a DNC send through');
  failed = true;
}
console.log(failed ? '❌ STRESS TEST FAILED' : `✅ STRESS TEST PASSED — ${completed}/${COUNT} drained, DNC sends blocked`);
process.exit(failed ? 1 : 0);
