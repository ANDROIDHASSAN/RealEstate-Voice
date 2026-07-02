# TrueCode AI OS — build rules

- Build in PHASE ORDER (see PROMPT §18). App must boot + phase acceptance test pass before next phase.
- Every module gated by `requireModule(flag)`. Every DB query scoped by `accountId` (multi-tenant isolation).
- Every outbound message/call goes through the Queue AND ComplianceGuard. No exceptions.
- Code to interfaces: `VoiceProvider`, `LLMProvider`, `QueueProvider` are abstract. Never import a concrete provider in business logic.
- Types live in `packages/shared`, imported by web + api. No duplicate types.
- TS strict. Zod-validate all external input. No secrets in code; update `.env.example` when adding a var.
- Agents are config-driven data (voice agents + crew agents), not hardcoded. Stubs are labeled `[STUB]`, never fake-functional.
- Missing API key ⇒ that provider runs in mock mode and the UI shows a "needs key" badge. Never crash on a missing key.
- Design: follow the reference tokens in `apps/web/src/styles/tokens.css` exactly. Poppins headings SemiBold/Bold, body Regular. Full RTL for `ar` (IBM Plex Sans Arabic).
- Every module ships a Recharts visualization + designed empty/loading/error states.
- Definition of done per phase: boots + acceptance test + smoke test green + DECISIONS.md updated.
- DO NOT: one-shot all modules blindly, orchestrate agents in Node (that's `services/agents`), send outbound without ComplianceGuard, go monochrome.

## Commands
- `npm run dev` — boots api (:4100 — 4000 is taken by another local app) + web (:5173+) locally (in-memory Mongo + queue when MONGO_URI/REDIS_URL unusable).
- Tests always run with `FORCE_MOCK_PROVIDERS=1` — the .env holds REAL provider keys; never let tests place real calls/SMS.
- `npm run build` — builds shared, api, web.
- `npm run test` — API integration tests (vitest + supertest).
- `npm run e2e` — Playwright E2E (starts servers itself).
- `npm run seed` — seeds the demo Empire account (demo@truecode.ai / Demo1234!).

## Layout
- `apps/web` React 18 + Vite + TS + Tailwind (tokens) + TanStack Query + Zustand + react-i18next + Recharts.
- `apps/api` Express + TS + Zod + Mongoose + queue abstraction (BullMQ when REDIS_URL set).
- `packages/shared` canonical types, Zod schemas, plan/module flags, voice-agent + crew-agent configs.
- `packages/integrations` twilio / whatsapp / resend / apify / ghl / stripe / llm clients — each with a mock mode.
- `services/agents` Python FastAPI + CrewAI-style config-driven orchestrator (deployed to Render; optional locally).
- `services/voice` VoiceProvider adapters (dograh / gemini-live / vapi / mock).
