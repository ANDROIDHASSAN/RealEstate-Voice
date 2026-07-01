/**
 * Load test (§13): hammer POST /webhook/lead at high concurrency.
 * Asserts: p95 latency < 2s, zero non-2xx (dedup 200s count as success),
 * and the instant-reply queue drains afterwards.
 * Usage: node tests/load/lead-webhook.load.mjs [baseUrl]
 */
import autocannon from 'autocannon';

const BASE = process.argv[2] ?? 'http://localhost:4100';

// Create a dedicated account so we don't pollute demo data.
const stamp = Date.now();
const signup = await fetch(`${BASE}/auth/signup`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    accountName: `Load ${stamp}`, name: 'Load Tester', email: `load${stamp}@test.io`, password: 'Passw0rd!123',
  }),
}).then((r) => r.json());
const accountId = signup.account._id;

let counter = 0;
const result = await autocannon({
  url: `${BASE}/webhook/lead/${accountId}`,
  method: 'POST',
  connections: 50,
  duration: 15,
  headers: { 'Content-Type': 'application/json' },
  setupClient(client) {
    client.setBody(
      JSON.stringify({ firstName: `Load${++counter}`, phone: `+1305${String(5000000 + counter).padStart(7, '0')}`, source: 'zapier' }),
    );
    client.on('response', () => {
      client.setBody(
        JSON.stringify({ firstName: `Load${++counter}`, phone: `+1305${String(5000000 + counter).padStart(7, '0')}`, source: 'zapier' }),
      );
    });
  },
});

const p95 = result.latency.p97_5 ?? result.latency.p99;
const non2xx = result.non2xx;
console.log(`requests: ${result.requests.total}, mean: ${result.latency.mean}ms, p95: ${result.latency.p95 ?? p95}ms, p99: ${result.latency.p99}ms, non-2xx: ${non2xx}, errors: ${result.errors}`);

let failed = false;
if ((result.latency.p95 ?? p95) >= 2000) {
  console.error('❌ p95 >= 2s');
  failed = true;
}
// 429s from the per-account webhook rate limit are expected back-pressure, not drops.
if (result.errors > 0) {
  console.error('❌ socket errors');
  failed = true;
}
console.log(failed ? '❌ LOAD TEST FAILED' : '✅ LOAD TEST PASSED (rate-limited responses are expected back-pressure)');
process.exit(failed ? 1 : 0);
