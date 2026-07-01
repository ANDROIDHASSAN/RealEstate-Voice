# DECISIONS.md — assumptions & deviations log

## 2026-07-02 — Phase 0

1. **No Docker / Python on this build machine.** `docker-compose.yml` and `services/agents` (FastAPI) are written and deploy-ready (Render), but local dev boots via `npm run dev` (Node only). The API calls the agents service over HTTP and degrades gracefully (built-in TS fallback router) when it is unreachable.
2. **MONGO_URI and REDIS_URL are empty in `.env`.** Local dev uses `mongodb-memory-server` (real mongod, in-memory) so Mongoose code is identical to Atlas. Queueing is behind a `QueueProvider` interface: `InMemoryQueueProvider` (supports delayed jobs, retries) when `REDIS_URL` is empty, `BullMQQueueProvider` when set. Business logic only sees the interface.
3. **All provider keys empty** → every integration (`twilio`, `whatsapp`, `resend`, `stripe`, `apify`, `ghl`, LLMs, voice) ships with a mock driver that logs the outbound payload to `Conversation`/`Call`/console and marks messages `status: "mock-sent"`. UI shows a "Needs API key" badge per provider on the Settings page. Nothing crashes.
4. **Voice provider default** = `mock` locally (env `VOICE_PROVIDER=dograh` is honored when `DOGRAH_BASE_URL` is set). The mock provider simulates a full call lifecycle (ringing → in-progress → completed) with a scripted transcript so M2's acceptance test is honest: the pipeline (dial → script → outcome → Appointment) is real; only audio is simulated.
5. **shadcn/ui** components are hand-authored in `apps/web/src/components/ui` in shadcn style (cva + tailwind tokens) rather than via the interactive CLI (non-interactive build). API-compatible with shadcn.
6. **Tailwind v3** (not v4) for stable config-file token support.
7. **Stripe in test/mock mode**: with no key, "subscribe" flips the plan directly on the account and writes a `UsageLedger` note (labeled mock). With a key, real Checkout test-mode sessions + webhook are used. Module gating logic is identical either way.
8. **Instagram (M6) & Video (M8)**: working UI + queue, wired to clearly-labeled `[STUB]` adapters (Meta App Review / external render API gates), per PROMPT honesty rule.
9. Not a git repository initially → `git init` performed; conventional commits per phase.
10. **npm workspaces** without turbo/nx to keep install light on the free-tier deploy targets.
11. **Node 22** locally (target Node 20 on Render — code targets ES2022, compatible with both).
12. **Local API port = 4100** (not 4000): port 4000 on this machine is occupied by the user's other project (`D:\truecodeai\emailtool`). `PORT` env still wins (Render sets its own). Vite proxy targets 4100.
13. **The provided `.env` contains REAL keys** (Gemini, Groq, Vapi, Twilio, Resend, Apify, ElevenLabs, Deepgram) mixed with placeholder lines that are whitespace/comments (JWT secrets, WHATSAPP_VERIFY_TOKEN). All env reads now sanitize inline comments; comment-only values count as unset. **JWT secrets fall back to dev-only values — set real ones in production.**
14. **`FORCE_MOCK_PROVIDERS=1`** forces every integration into mock mode — used by vitest/E2E/acceptance/load so real keys never place real calls or SMS at test numbers. Production omits it.
15. **MONGO_URI in .env is malformed** (SRV lookup resolves host "1216" — likely an unencoded password or truncated URI). Boot tries it with an 8s timeout and falls back to in-memory Mongo with a loud log. Fix the URI for persistent data.
16. **REDIS_URL in .env is an Upstash `https://` REST URL** — BullMQ needs `redis(s)://`. Non-redis URLs are ignored (in-memory queue). Paste the Upstash TLS URL to enable BullMQ.
17. **LLM = fallback chain** (Gemini → Groq → labeled mock) so one bad key never breaks captions/WhatsApp replies. The Gemini key in .env is an "AQ." style key; if generativelanguage rejects it, Groq picks up silently.
18. **VOICE_PROVIDER=vapi in .env returned 401** with the provided key. Default deploy config uses `mock` (full simulated call lifecycle, clearly labeled) until Dograh is self-hosted (`DOGRAH_BASE_URL`) or the Vapi key is fixed. Real-call paths are implemented in the adapters.
19. **Demo seeding**: `POST /auth/seed-demo` (dev always; prod only when `ALLOW_DEMO_SEED=1`) because local dev's in-memory Mongo can't be seeded from a separate process. Seed backdates `createdAt` via the raw collection (Mongoose treats it as immutable).
20. **Webhook rate limit = 600/min/account** — the load test's 429s are intended back-pressure, not drops (10,870 reqs, p95 660ms, 0 socket errors).
21. **Known-flaky:** none currently. Full green: acceptance 33/33, vitest 10/10, Playwright E2E 8/8, load pass, stress 300/300 with DNC blocks verified.
22. **Python agents service** is written and deploy-ready (Render blueprint) but was not run locally (no Python on this machine); the API's TS fallback router covers M9 locally and is exercised by tests. CrewAI can replace the internal lightweight crew without changing the HTTP contract.
