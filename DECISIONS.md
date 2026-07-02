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

## 2026-07-02 — Live agents, assistant, in-app keys, Lead Engine presets

23. **Agent activity bus is in-memory** (`apps/api/src/lib/events.ts`): per-account ring buffer (200 events) + SSE stream at `GET /events/stream?token=`. EventSource cannot send headers, so the short-lived access JWT rides as a query param and is verified exactly like `requireAuth`. Mongo `AgentRun` remains the durable record; the bus is UX-only, so losing it on restart is acceptable.
24. **In-app API keys** (`/integrations`): stored per account in `IntegrationSetting`, always masked on read, applied to `process.env` on save and on boot. Env is process-wide, so on a multi-tenant deployment the most recent save wins — acceptable for the current single-operator model; a per-request credential resolver is the upgrade path. Var names are allow-listed against the catalog so arbitrary env injection is impossible. `FORCE_MOCK_PROVIDERS=1` still overrides everything in tests.
25. **Assistant** (`POST /assistant/command`): the LLM only *plans* (closed, Zod-validated action set); Node *executes* through the same queue + ComplianceGuard paths as the UI. With no LLM key a deterministic English rule parser handles the core commands so voice control works keyless. Voice I/O is browser-native (Web Speech API + speechSynthesis) — no audio keys needed, degrades to typed input where unsupported.
26. **Lead Engine presets** live in `packages/shared/src/lead-personas.ts` (12 top prospect segments with source/query/filter defaults) — config data, not code, per the agents-are-data rule. Scrape `filters` are persisted on the job and forwarded to Apify when live; the mock dataset ignores them (labeled sample data).
27. **Onboarding tour** is client-side only (`cf-onboarded` localStorage flag) with a replay button in the header; no server state.

## 2026-07-02 — Selectable LLM / voice providers & models

28. **Provider + model dropdowns** are declared as `options` on each entry in the
    integrations catalog (`apps/api/src/routes/integrations.ts`) alongside the key
    `fields`. They persist through the same per-account `IntegrationSetting` → env
    mechanism as keys, but are constrained to their declared `choices`
    (`OPTION_CHOICES`) so a saved selection can't inject an arbitrary value. They
    are not secrets, so the current selection is returned in `GET /integrations`.
29. **LLM is now a preference-ordered fallback across Gemini / Groq / OpenAI.**
    `LLM_PROVIDER` (auto|gemini|groq|openai) picks which is tried first; each
    provider's model is configurable (`GEMINI_MODEL` / `GROQ_MODEL` / `OPENAI_MODEL`).
    OpenAI and Groq share one OpenAI-compatible client. Missing/bad keys still fall
    through to the labeled mock — a selection never breaks AI features.
30. **Voice pipeline is configurable** — call provider (`VOICE_PROVIDER`), TTS
    (`VOICE_TTS_PROVIDER`/`VOICE_TTS_VOICE`), STT (`VOICE_STT_PROVIDER`), and the
    in-call brain (`VOICE_LLM_PROVIDER`/`VOICE_LLM_MODEL`) are read by the Vapi
    adapter instead of being hardcoded. Saving voice settings calls
    `resetVoiceProvider()` so the cached singleton rebuilds without a restart.

## 2026-07-02 — Local DB persistence, boot auto-seed, voice-page LLM selector

31. **Local dev DB now persists to disk.** When falling back to the bundled
    mongod (no/again-malformed MONGO_URI) AND not in a mock/test run, data is
    written to `.local-data/mongo` (gitignored) so a restart keeps your login,
    session and data — fixing the "logged out / demo gone every time" symptom.
    A stale `mongod.lock` from a hard `tsx watch` reload is cleared on start.
    Tests / acceptance / e2e (FORCE_MOCK_PROVIDERS=1) stay non-persistent and
    isolated (`shouldPersistLocalDb()` gates on it).
32. **Demo account auto-seeds on boot** (idempotent `seedDemo()`; opt out with
    AUTO_SEED_DEMO=0) so a fresh or reset local DB always has a working login
    (demo@truecode.ai / Demo1234!). Unit tests never run `main()`, so they're
    unaffected.
33. **Background dev servers started from the assistant end with its session.**
    That is a harness limitation, not the app — to keep the app up across
    sessions, run `npm run dev` in your own terminal. Persistence (#31) means a
    restart there loses nothing.
34. **Voice page has an in-call LLM/voice selector** (`voice.engine` card) that
    reads/writes the same `/integrations/voice` options (VOICE_LLM_PROVIDER,
    VOICE_LLM_MODEL, VOICE_TTS_PROVIDER) as Settings — so the model can be
    picked right where calls are configured.

## 2026-07-02 — Voice self-test ("call me now")

35. **Live self-test call** (`POST /calls/test` + `GET /calls/test-info`, Voice
    page "Test your voice agent" card): places an outbound call to the user's own
    number so they can hear the agent. Reuses one `source:'test'` lead per account
    with full consent (the user explicitly requested it) and bypasses quiet hours
    for the live self-test (not automated bulk). Real when Vapi/Dograh is
    configured; a simulated lifecycle + transcript in mock mode.
36. **Voice worker resolves the provider PER JOB** (was captured once at boot), so
    switching the call provider in Settings/Voice takes effect live via
    `resetVoiceProvider()`. It also now catches `startOutboundCall` errors and
    marks the call `failed` with the reason (e.g. "Vapi HTTP 401") instead of
    leaving it stuck at "queued".
37. **Call-provider + in-call LLM/TTS selectors are on the Voice page** (not just
    Settings) so a demo can be configured where calls happen — pick Mock for a
    guaranteed simulated run, or a real provider to dial an actual phone.

## 2026-07-02 — Knowledge base (RAG) + Vapi-style Agent Studio

38. **RAG knowledge base** (`/knowledge`, `packages/integrations/src/embeddings.ts`,
    `apps/api/src/lib/knowledge.ts`): documents are chunked (~700 chars, sentence
    boundaries) and embedded. Embeddings default to Gemini `gemini-embedding-001`
    via `embedContent` (this key does not serve `text-embedding-004`/batch — model
    is overridable with `EMBEDDINGS_MODEL`), OpenAI `text-embedding-3-small` as
    fallback. With no key, retrieval degrades to a keyword-overlap scorer — never
    crashes. Retrieval is cosine over stored vectors; a per-account system prompt
    lives on `Account.voiceSystemPrompt`.
39. **Voice calls are RAG-grounded**: the worker retrieves top chunks scoped to the
    lead's interest/location and injects them + the system prompt into the Vapi
    assistant's systemPrompt. The mock provider cites a retrieved fact in the
    transcript so grounding is visible without a live provider.
40. **Voice Agent Studio** (`/voice-agents`, `apps/web/.../voice/AgentStudio.tsx`):
    a Vapi-style builder. Agents are config-driven data — presets in
    `@truecode/shared` can be overridden per account, and custom agents created.
    Each agent has: identity + first message, system prompt, transcriber (STT),
    model (LLM) + temperature, voice (TTS), tool toggles (transfer/hangup/voicemail/
    DTMF/send-text/query-KB/API-request/book/tag), and attached KB docs. The worker
    resolves the effective agent (preset ⊕ override) and passes the pipeline
    overrides through `VoiceCallRequest` to the provider. Catalog choices live in
    `voice-studio.ts` and are validated server-side.

## 2026-07-02 — Knowledge base document upload (NotebookLM-style)

41. **File upload + URL import for the knowledge base** (`POST /knowledge/upload`
    multipart, `POST /knowledge/url`). Text is extracted (`apps/api/src/lib/extract.ts`)
    from PDF (`pdf-parse`, imported at the lib subpath to skip its debug harness),
    DOCX (`mammoth`), and any UTF-8/HTML text, then chunked + embedded through the
    same RAG pipeline as pasted text. Uploads are in-memory (multer 2.x, 15MB cap),
    text-only — raw files are never stored. Extracted text is capped at 60k chars
    so one big PDF can't spawn hundreds of embedding calls. The web KB card has a
    drag-and-drop zone, a file picker, and a URL importer alongside the paste form.

## 2026-07-02 — Property Intelligence (multi-agent investment analysis) — M11

42. **New gated module `propertyIntel`** (Pro + Empire; `packages/shared/modules.ts`).
    Turns any listing into a full investment report via 5 config-weighted specialist
    agents: Comparable Sales (25%), Rental Income (20%), Neighborhood (20%),
    Investment Strategy (20%), Market Trend (15%). The orchestrator produces a
    weighted 0–100 Investment Score, letter grade + tier, recommendation
    (Strong Buy / Buy / Hold / Negotiate / Wait / Avoid), fair-market value,
    suggested-offer range, cash-flow/cap-rate/DSCR/ROI, risk score, opportunities,
    a deal (flip) analysis, and a full SWOT + negotiation narrative.
43. **The engine is a pure, deterministic, dependency-free module in
    `@truecode/shared` (`property-intel.ts`)** — shared by web + api, unit-testable,
    and re-run-stable. ALL financial numbers are real math (amortization, NOI, cap
    rate, cash-on-cash, GRM, 5/10-yr ROI). Data with no external source (comps,
    neighborhood, market) is a model *seeded from the address* via a mulberry32 PRNG,
    so a property always scores identically — labelled "modeled estimate" in the
    explainability layer, never presented as live MLS/records data. Honors the
    mock-mode rule: works fully with zero API keys.
44. **LLM enrichment is prose-only** (`apps/api/src/lib/property-agents.ts`): when an
    LLM key is live it rewrites the narrative (executive summary, SWOT, negotiation
    script) and never touches a number; deterministic narrative is the always-present
    fallback. A report-scoped AI chat (`POST /property-analysis/:id/chat`) answers
    grounded in the computed report, with intent-matched deterministic answers when
    no key is set.
45. **Async multi-agent run** mirrors the orchestrator/lead-engine pattern: `POST
    /property-analysis` persists a `PropertyAnalysis` doc (running) + enqueues
    `QUEUES.propertyAnalysis`; the worker emits a live `emitAgentEvent` per specialist,
    computes + enriches, saves the report (done/error), and bills `aiTokens` usage.
    The web page (`/property-intelligence`) polls until done and renders an animated
    circular score (`ScoreRing`), Recharts radar/bar/area charts, comps table, risk
    grid, opportunities, negotiation script, the grounded AI chat, and a zero-dep
    branded print-to-PDF report (`lib/reportPdf.ts`). Seed adds 3 pre-computed demo
    reports. Every query is `accountId`-scoped; tenant isolation + gating covered by
    tests (49 passing).

## 2026-07-02 — Quotations & Proposals — M12

46. **New gated module `quotations`** (Pro + Empire). Owner-facing sales documents:
    build a branded quote/proposal from a real-estate template (premium/standard
    listing, buyer representation, seller closing-cost estimate, commission
    proposal, or blank), send it, and track draft → sent → viewed → accepted /
    declined / expired. Endpoints under `/quotations`: CRUD, `/templates`, `/stats`,
    `/:id/send`, `/:id/status`, `/:id/duplicate`.
47. **Money math is pure + server-authoritative** (`@truecode/shared/quotations.ts`):
    `computeTotals` (subtotal → discount %/amount → tax → total) is recomputed on
    every create/update — a tampered client `totals` is ignored (covered by a test).
    Templates + currencies live in shared config. A `commissionBreakdown` helper
    powers the on-page commission calculator (gross → agent split → brokerage cut →
    net after transaction fee). Accepted quotes are locked from edits (409).
48. **Web** (`/quotations`): pipeline stat cards + a status donut (Recharts), the
    commission calculator, a live-totals **QuoteBuilder** (template picker, line-item
    editor, currency/tax/discount), a read-only preview with lifecycle actions, and a
    zero-dependency branded **print-to-PDF** (`lib/quotePdf.ts`). Nav + route + gate +
    i18n (nav label in all 5 locales, full strings in en with fallback). Seed adds 3
    demo quotes; tenant isolation + gating + tamper-resistance covered by tests
    (58 passing total).

## 2026-07-02 — Owner Suite: Invoicing, Deals, Ledger, Documents + Client Portal + CMA — M13

49. **Four new gated modules** (Pro + Empire), each `accountId`-scoped, tested:
    - `invoicing` — invoices with a payment ledger; `computeTotals` + `invoiceBalance`
      (pure, server-authoritative) drive draft→sent→partial→paid; `from-quote/:id`
      converts an accepted quote; per-invoice branded print-to-PDF (`invoicePdf.ts`).
    - `deals` — Kanban pipeline over 7 real-estate stages with per-stage probability
      (weighted pipeline value) and commission forecasting; `PATCH /:id/stage` moves.
    - `ledger` — income/expense book; `summarizeLedger` returns totals, by-category,
      and a monthly income-vs-expense series (Recharts P&L).
    - `documents` — agreement/disclosure/addendum templates with `{{merge}}` fields;
      e-signature lifecycle draft→sent→viewed→signed; signed docs lock.
50. **Client / Owner Portal** — a PUBLIC, unauthenticated `/portal/:kind/:token`
    router (mirrors the `/site/:slug` pattern). Quotes, invoices and documents each
    mint an opaque `publicToken` on share/send; the token is the capability. Clients
    view and **accept a quote** or **e-sign a document** with no login; only
    whitelisted fields are returned, and actions emit account activity events. Web:
    `PublicPortal.tsx` (branded, outside the auth shell).
51. **CMA one-pager** — a client-facing Comparative Market Analysis PDF
    (`downloadCmaPdf`) reuses the Property Intelligence engine (comps + fair value +
    market) with no investor jargon — a "Client CMA" button on every report.
52. All money math stays in `@truecode/shared` (`owner-suite.ts`); totals/balances
    are recomputed server-side and never trusted from the client (tested). 11 new
    tests cover totals, payments→paid, stage moves + commission, ledger summary,
    doc e-sign via the public portal, quote accept via portal, quote→invoice
    conversion, gating and tenant isolation. Full suite: **69 passing**. Seed
    populates deals, ledger, an invoice and a listing agreement for the demo.

## 2026-07-02 — Multi-tenant RBAC + Super Admin — M14

53. **Two orthogonal access axes** (`@truecode/shared/rbac.ts`):
    - **Tenant role** — owner / admin / agent / viewer, mapped to permissions
      (`members:manage`, `account:manage`, `account:billing`, `data:write`,
      `data:read`) via `ROLE_PERMISSIONS` + `can()`. `canManageRole` enforces that
      only an owner may create/modify owner/admin members.
    - **Platform role** — user / superadmin, independent of tenant role; only
      unlocks the cross-tenant `/admin` surface. Both now live in the JWT
      (`AuthContext` gained `platformRole`) and are re-read on refresh so role
      changes take effect without re-login.
54. **Enforcement middleware** (`middleware/auth.ts`): `requirePermission(perm)`,
    `rbacWrite` (GET = read, any mutation needs `data:write` → makes `viewer`
    read-only), and `requireSuperAdmin`. `rbacWrite` is mounted on every business
    router (leads, quotations, invoicing, deals, ledger, documents,
    property-analysis); `account:manage` gates account/compliance edits and
    `account:billing` gates `/billing/subscribe`.
55. **Team management** (`/members`, web `/team`): list, invite (returns a one-time
    temp password — no email infra), change role, suspend/reactivate, remove. The
    **last owner can never be demoted, suspended, or removed** (no lockout).
    Everything is `accountId`-scoped.
56. **Super admin** (`/admin`, web `/admin`, superadmin-only): platform KPIs
    (tenants, users, est. MRR, suspended), a searchable tenant table, change a
    tenant's plan/modules/status, **suspend** (blocks that tenant's logins),
    **delete** (cascades across all that tenant's collections), and **impersonate**
    — issues a tenant-scoped access token that deliberately DROPS superadmin (a
    support session can't reach `/admin`); the operator's own session is stashed
    client-side and restored via the "Exit" banner in the shell.
57. Seed adds a super admin (**super@truecode.ai / Super1234!**), an admin/agent/
    viewer member in the demo account, and two extra tenants so the admin
    dashboard has a portfolio. 10 new tests cover role permissions, viewer
    read-only, last-owner protection, member tenant-scoping, superadmin gating,
    plan change, suspend-blocks-login, and impersonation scope. Full suite: **79
    passing.**

## 2026-07-02 — Website CMS (block-based, self-service) — M15

58. **New gated module `cms`** (Pro + Empire) — a full, industry-grade website
    content system per account. Everything the public site renders is editable:
    **Site settings** (brand, logo, theme colors + font, contact, social, SEO,
    navigation menu, footer, publish toggle), **Pages** and **Blog posts** built
    from a block registry, with draft/published workflow, per-item SEO, cover
    image, nav placement, and a "home page" flag.
59. **Block registry drives everything** (`@truecode/shared/cms.ts`,
    `BLOCK_TYPES`). Each block is `{ id, type, data }`; the registry describes each
    type's editable fields (kind: text/textarea/url/lines/color/select). The web
    editor renders that generically and the public renderer (`BlockView`) switches
    on type — so a new block is one registry entry + one render case, no schema
    churn. Blocks shipped: hero, rich text, image, gallery, features, stats,
    testimonial, CTA, contact form (wired to the lead webhook), HTML embed,
    divider. Mongoose gotcha noted: a subdoc field named `type` must use an
    explicit sub-Schema (`cmsBlockSchema`) or it's parsed as a SchemaType.
60. **Public renderer** — `/public-cms/:siteSlug` (index: config + nav + published
    pages + posts + home) and `/public-cms/:siteSlug/content/:slug` (a published
    page/post, increments views). Unauthenticated, published-only, keyed by the
    account's `websiteSlug`. Web route `/read/:slug[/:contentSlug]`
    (`PublicCms.tsx`) applies the theme and renders the block tree with a live
    header/footer; the CMS admin (`/cms`) has tabbed Pages/Posts/Settings, a
    live-preview block editor, and publish/duplicate/delete.
61. Content is `accountId`-scoped and `rbacWrite`-guarded (viewers read-only).
    Seed provisions the demo site (published, brand + theme, a home page with
    hero/stats/features/testimonial/contact blocks, and a blog post) at
    `/read/miami-luxe`. 10 new tests cover settings, auto/unique slugs, the block
    registry, public rendering (published-only + view counts), publish/unpublish
    visibility, module gating, tenant scoping and Zod validation. Full suite:
    **89 passing.**

## 2026-07-02 — Ultimate plan (all-inclusive) — M16

62. **New top tier `ultimate`** ($3,997/mo+) — includes EVERY module. Its module
    list is derived from `MODULES` via `ALL_MODULES = Object.values(MODULES)`, so
    any module added in the future is automatically part of Ultimate (no drift).
    Wired through the plan enum everywhere: Account model, `subscribeSchema`,
    admin `PATCH /accounts` schema + dropdown, and the web session/plan types.
    Billing grid now lays out 4 plans and flags Ultimate with a "★ Everything"
    badge; the super-admin tenant table can assign it. A test asserts subscribing
    to Ultimate enables every `MODULES` flag and unlocks previously empire-only
    endpoints. Full suite: **90 passing.**

## 2026-07-02 — Voice demo is now a live voice-to-voice call

63. **Browser agent demo upgraded to a hands-free call.** `AgentDemo.tsx` is a
    state machine (connecting → speaking → listening → thinking → loop): the agent
    greets and speaks via `speechSynthesis`, then the mic opens automatically
    (`SpeechRecognition`), your reply is transcribed + sent, and the agent speaks
    back — no tapping between turns. `speak()` gained an `onEnd` callback (with a
    length-based safety timeout for browsers that drop `onend`) to drive the loop,
    plus `stopSpeaking()`. Call UI: animated state orb, live captions, timer,
    mute-mic / speaker / hang-up controls, and a "type instead" fallback for
    browsers without speech recognition (headless included).
64. **Fixed raw merge tokens in the demo greeting** — `{{lead.propertyInterest}}`
    (and other lead fields) now fill with sample demo values via `fillDemoMerge`,
    which also strips any leftover `{{…}}` so a caller never hears a template.
    E2E updated to drive the new call UI via the type-fallback. Suite: 90 passing.

## 2026-07-03 — Voice call: barge-in, cross-device, deployment-safe

65. **Barge-in / interruptions.** `useMicLevel` (getUserMedia + AnalyserNode with
    echoCancellation/noiseSuppression) runs voice-activity detection: while the
    agent is speaking the detector is armed after a 600ms grace, and sustained
    speech energy cancels the TTS and opens the mic — the caller can talk over the
    agent like a real call. Echo cancellation keeps the agent's own speaker audio
    from self-triggering. Tapping the orb also interrupts. The orb scales with the
    live mic level.
66. **All devices / browsers.** The call modal is mobile-first (`h-[100dvh]`
    full-screen on phones, `sm:` card on desktop) with controls always visible.
    Feature-detects: no SpeechRecognition (iOS Safari / Firefox) → the agent still
    speaks and the caller types (auto-shown fallback + note); non-secure context →
    a clear "voice needs https" note. Mic denied → degrades to tap-to-interrupt.
67. **Deployment-safe.** CORS now allows the configured `APP_URL`, localhost, and
    any `*.vercel.app` / `*.onrender.com` origin (incl. preview URLs) via an origin
    callback (reflaction required with credentials) — the split web(Vercel) /
    api(Render) setup and mobile browsers work without per-deploy tweaks.
    `apps/web/vercel.json` already rewrites all routes to index.html so public deep
    links (`/read/:slug`, `/portal/:kind/:token`) resolve; `render.yaml` builds/runs
    the API with `APP_URL` for CORS. Web Speech APIs require HTTPS — satisfied by
    Vercel/Render automatically. Suite: 90 passing.

## 2026-07-03 — Elite "top-0.1% closer" agent persona

68. **One reusable sales playbook** (`packages/shared/src/sales-persona.ts`,
    `buildSalesSystemPrompt`) makes every voice agent sound like a warm, natural,
    top-0.1% real-estate closer: conversational voice rules (1–2 sentence turns,
    one question at a time, mirror the caller), a full discovery → build-desire →
    ethical-influence → assumptive-close method (Cialdini principles, emotional
    "why", tie-downs, honest urgency), and a scripted **objection-handling**
    playbook (price, "just looking", "need to think", spouse, market timing,
    call-back) using acknowledge → empathise → reframe → advance.
69. **Multilingual by design** — the prompt instructs the agent to detect the
    caller's language and always reply in it natively, switching mid-call if they
    do (the opener uses the agent's configured language). Works for any language
    the LLM supports, beyond the 5 UI locales.
70. **Ethical guardrails, not deception** — the agent persuades by uncovering real
    needs and framing genuine value; it must never invent prices/features, fake
    scarcity, or pressure someone who declines. Used by BOTH the browser demo
    (`/voice-agents/:key/demo`) and live provider calls (`workers/voice-call.ts`)
    so behaviour is identical everywhere. The keyless fallback now does basic
    objection handling too. Suite: 90 passing.
