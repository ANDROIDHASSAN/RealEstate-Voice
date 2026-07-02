# TrueCode AI OS

**The operating system a real estate agent runs their whole business on.** Captures leads, replies in under 60 seconds, qualifies and books by AI voice, follows up across SMS/WhatsApp/email forever, runs their content — one beautiful pastel dashboard, five languages (en · es · ar · pt · ht), full RTL.

| Tier | $/mo | Unlocks |
|---|---|---|
| Starter | 297 | Core + Instant Reply |
| Pro | 997 | + Voice + Follow-up + WhatsApp |
| Empire | 1997+ | + Lead Engine + Website + Multi-agent + Content/Video |

## Quick start
```bash
npm install
npm run dev          # api :4100 + web :5173 (in-memory Mongo/queue when no env keys)
npm run seed         # demo account — or POST /auth/seed-demo on a running dev API
# login: demo@truecode.ai / Demo1234!
```

## Tests (all green)
```bash
npm test             # vitest API integration (10)
npm run e2e          # Playwright — signup, gating, instant reply, voice, es/ar RTL, isolation (8)
npm run acceptance   # scripts/acceptance.mjs — phase acceptance vs a live API (33 checks)
npm run load         # autocannon on POST /webhook/lead — p95 < 2s
npm run stress -- http://localhost:4100 300   # 300 drips drain + DNC blocked
```

## Layout
- `apps/web` — React 18 + Vite + Tailwind tokens (reference pastel design), TanStack Query, react-i18next (5 locales, RTL), Recharts on every module.
- `apps/api` — Express + TS + Zod + Mongoose. Queue abstraction (in-memory ⇄ BullMQ). Every outbound goes through **ComplianceGuard** (DNC, TCPA consent, quiet hours, STOP).
- `packages/shared` — canonical types, Zod schemas, plan/module flags, **20 voice-agent configs**, **20 crew-agent configs**.
- `packages/integrations` — Twilio, WhatsApp Cloud, Resend, Apify, GHL, Stripe, LLM (Gemini→Groq→mock fallback chain). Every client has a labeled mock mode; missing keys never crash.
- `services/voice` — `VoiceProvider` interface: dograh (default) / gemini-live / vapi / mock adapters.
- `services/agents` — Python FastAPI multi-agent orchestrator (config-driven crew, LLM-refined next-best-action, Compliance Guard final say). Node falls back to a TS rule router when unreachable.

## Deploy
See **[DEPLOY.md](DEPLOY.md)** — web → Vercel, api+agents → Render (`render.yaml` blueprint), docker-compose for local parity. Decisions and assumptions: **[DECISIONS.md](DECISIONS.md)**.
