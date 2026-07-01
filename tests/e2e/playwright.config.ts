import { defineConfig } from '@playwright/test';

/**
 * E2E config — boots the API (mock providers, in-memory Mongo) and the web
 * dev server, then runs browser tests. Override E2E_BASE_URL + E2E_API_URL to
 * run blackbox against deployed Vercel/Render URLs (servers are skipped).
 */
const remote = Boolean(process.env.E2E_BASE_URL);

export default defineConfig({
  testDir: '.',
  timeout: 60_000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5199',
    screenshot: 'only-on-failure',
  },
  webServer: remote
    ? undefined
    : [
        {
          command: 'npx tsx apps/api/src/index.ts',
          url: 'http://localhost:4144/health',
          reuseExistingServer: false,
          timeout: 120_000,
          cwd: '../..',
          env: {
            PORT: '4144',
            FORCE_MOCK_PROVIDERS: '1',
            COMPLIANCE_IGNORE_QUIET_HOURS: '1',
            MOCK_CALL_DELAY_MS: '500',
            MONGO_URI: '',
            REDIS_URL: '',
            APP_URL: 'http://localhost:5199',
          },
        },
        {
          command: 'npx vite --port 5199 --strictPort',
          url: 'http://localhost:5199',
          reuseExistingServer: false,
          timeout: 120_000,
          cwd: '../../apps/web',
          env: { VITE_API_PROXY: 'http://localhost:4144' },
        },
      ],
});
