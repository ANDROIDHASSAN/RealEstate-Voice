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
    (demo@closeflow.io / Demo1234!). Unit tests never run `main()`, so they're
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
    `@closeflow/shared` can be overridden per account, and custom agents created.
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
