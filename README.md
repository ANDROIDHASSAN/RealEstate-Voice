# TrueCode AI OS

**The operating system a real estate agent runs their whole business on.** Captures leads, replies in under 60 seconds, qualifies and books by AI voice, follows up across SMS/WhatsApp/email forever, runs their content — one beautiful pastel dashboard, five languages (en · es · ar · pt · ht), full RTL.

| Tier | $/mo | Unlocks |
|---|---|---|
| Starter | 297 | Core + Instant Reply |
| Pro | 997 | + Voice + Follow-up + WhatsApp + **Property Intelligence** + **Quotations** |
| Empire | 1997+ | + Lead Engine + Website + Multi-agent + Content/Video |
| **Ultimate** | 3997+ | **Everything** — every module, always (incl. Owner Suite, CMS, RBAC) |

**Property Intelligence** turns any listing into a full investment report in under 60 seconds: 5 weighted AI specialist agents (comps · rental · neighborhood · strategy · market) → animated Investment Score, fair value, cash flow / cap rate / ROI, risk, opportunities, a grounded report AI chat, and a branded print-to-PDF report. Pure deterministic engine in `packages/shared` (works with zero keys); LLM enriches the narrative only.

**Quotations & Proposals** — build a branded quote from a real-estate template (listing package, buyer representation, closing estimate, commission proposal), track it draft → sent → accepted, and export a print-to-PDF. Server-authoritative totals, a built-in commission calculator, pipeline stats. `/quotations`.

**Owner Suite** — the back office a real-estate business runs on:
- **Invoicing & Payments** (`/invoicing`) — invoice clients (or convert an accepted quote), record payments to paid, branded PDF, shareable client link.
- **Deal Pipeline** (`/deals`) — Kanban from lead → closed across 7 stages, weighted pipeline value + commission forecasting.
- **Commission & Expense Ledger** (`/ledger`) — income/expense book with a monthly P&L chart.
- **Documents & E-sign** (`/documents`) — listing agreements, buyer-rep, disclosures; clients sign online.
- **Client Portal** (`/portal/:kind/:token`) — public, no-login pages where clients view and **accept quotes** or **e-sign documents**.
- **Client CMA** — a jargon-free comparative-market-analysis one-pager exported from any Property Intelligence report.

**RBAC & Super Admin** — proper multi-tenant access control:
- **Roles** (owner / admin / agent / viewer) with a permission model; `viewer` is read-only everywhere, `agent` can edit data but not billing/team, only `owner` touches owner/admin roles and the last owner can't be removed.
- **Team page** (`/team`) — invite members, assign roles, suspend/remove.
- **Super Admin** (`/admin`, platform-role gated) — cross-tenant dashboard: KPIs & est. MRR, change any tenant's plan/status, suspend, delete, and **impersonate** ("view as tenant"). Demo operator: `super@truecode.ai` / `Super1234!`.

**Website CMS** (`/cms`) — a self-service, block-based site builder. Edit **everything**: brand, logo, theme colors/font, contact, social, SEO, navigation and footer; build **pages** and a **blog** from blocks (hero, features, gallery, stats, testimonial, CTA, contact form, HTML embed…) with a live preview, draft/publish workflow and per-page SEO. Public site renders at `/read/:siteSlug` — the demo site is live at `/read/miami-luxe`.

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
