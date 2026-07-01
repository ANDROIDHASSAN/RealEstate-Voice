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
