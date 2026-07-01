# CloseFlow OS — Deploy (one page)

Two live URLs to send realtors:
- **Web (Vercel):** `https://<your-project>.vercel.app` — the dashboard
- **API (Render):** `https://closeflow-api.onrender.com` — webhook base for lead sources

## 0. Prereqs (all free tiers)
- MongoDB Atlas M0 cluster → copy the `mongodb+srv://user:pass@cluster/closeflow` URI (URL-encode special chars in the password!).
- Upstash Redis → copy the **`rediss://`** URL (the "TLS/Redis" one, NOT the `https://` REST URL).
- GitHub repo pushed (`git remote add origin … && git push -u origin main`).

## 1. API + Agents → Render
1. Render → New → **Blueprint** → pick this repo. `render.yaml` provisions both services:
   - `closeflow-api` (Node) with `/health`
   - `closeflow-agents` (Python FastAPI) with `/health`
2. Fill the prompted env vars: `MONGO_URI`, `REDIS_URL`, `APP_URL` (your Vercel URL), plus any provider keys you have (`GEMINI_API_KEY`, `GROQ_API_KEY`, `TWILIO_*`, `RESEND_API_KEY`, `APIFY_TOKEN`, `STRIPE_*`). Missing keys ⇒ that feature runs in labeled mock mode; nothing crashes.
3. Free-tier note: services sleep after ~15 min. Add a keep-warm ping (cron-job.org, every 10 min) to `https://closeflow-api.onrender.com/health`.

## 2. Web → Vercel
1. Vercel → New Project → import the repo.
2. **Root Directory:** `apps/web` · Framework: Vite.
3. **Build Command:** `cd ../.. && npm ci && npm run build -w packages/shared && npm run build -w apps/web`
   **Output Directory:** `dist`
4. Env var: `VITE_API_URL=https://closeflow-api.onrender.com`
5. Deploy. `vercel.json` already handles the SPA rewrites.
6. Back on Render, set `APP_URL` to the Vercel URL (CORS + refresh cookies need it).

## 3. Seed the demo (so the link looks alive)
```
curl -X POST https://closeflow-api.onrender.com/auth/seed-demo
```
Login: **demo@closeflow.io / Demo1234!** (Empire plan, sample leads/calls/charts).
Requires `ALLOW_DEMO_SEED=1` (already set in render.yaml).

## 4. Wire lead sources
Point Zillow/Facebook/Zapier/website forms at:
```
POST https://closeflow-api.onrender.com/webhook/lead/<accountId>
{ "firstName": "...", "phone": "+1...", "source": "zillow", "propertyInterest": "...", "locale": "en" }
```
(The Website page in the dashboard shows each account's exact URL.)

## 5. Provider webhooks (when keys are live)
- Twilio SMS inbound → `POST /webhook/sms/inbound`
- WhatsApp Cloud API → `GET|POST /webhook/whatsapp` (verify token = `WHATSAPP_VERIFY_TOKEN`)
- Stripe → `POST /webhook/stripe` (set `STRIPE_WEBHOOK_SECRET`)
- Voice providers (Dograh/Vapi) → `POST /webhook/voice/:provider`

## 6. Blackbox test against live URLs
```
node scripts/acceptance.mjs https://closeflow-api.onrender.com
E2E_BASE_URL=https://<project>.vercel.app E2E_API_URL=https://closeflow-api.onrender.com npm run e2e
```

## Local dev
`npm install && npm run build -w packages/shared -w packages/integrations -w services/voice && npm run dev`
→ web http://localhost:5173 (or next free port), api http://localhost:4100. Empty `MONGO_URI`/`REDIS_URL` ⇒ in-memory DB + queue.
