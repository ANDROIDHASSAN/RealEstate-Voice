import { config } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env first (local dev), then any local overrides.
const here = dirname(fileURLToPath(import.meta.url));
for (const p of [resolve(here, '../../../.env'), resolve(process.cwd(), '.env')]) {
  if (existsSync(p)) config({ path: p });
}

/**
 * Sanitize an env value: drop inline comments (` # …`), trim whitespace.
 * The provided .env contains placeholder lines like `JWT_SECRET=   # generate me`,
 * which must be treated as "not set", never as a real (empty) secret.
 */
function clean(raw: string | undefined): string {
  if (!raw) return '';
  const withoutComment = raw.replace(/\s+#.*$/, '');
  const trimmed = withoutComment.trim();
  return trimmed.startsWith('#') ? '' : trimmed;
}

// Only redis:// / rediss:// URLs work with BullMQ (Upstash REST https:// URLs don't).
const rawRedis = clean(process.env.REDIS_URL);
const usableRedis = /^rediss?:\/\//.test(rawRedis) ? rawRedis : '';

// A usable Mongo URI must at least parse as mongodb(+srv)://
const rawMongo = clean(process.env.MONGO_URI);
const usableMongo = /^mongodb(\+srv)?:\/\/.+\..+/.test(rawMongo) ? rawMongo : '';

export const env = {
  nodeEnv: clean(process.env.NODE_ENV) || 'development',
  // 4100 default: 4000 is commonly taken by other local tools (DECISIONS.md #12).
  port: Number(clean(process.env.PORT) || 4100),
  appUrl: clean(process.env.APP_URL) || 'http://localhost:5173',
  apiUrl: clean(process.env.API_URL) || 'http://localhost:4100',
  jwtSecret: clean(process.env.JWT_SECRET) || 'dev-only-secret-change-me',
  jwtRefreshSecret: clean(process.env.JWT_REFRESH_SECRET) || 'dev-only-refresh-change-me',
  // Access-token lifetime. Short in production (refresh keeps sessions alive);
  // long in local dev so you're never logged out mid-work. Override with
  // ACCESS_TOKEN_TTL (e.g. "15m", "12h", "30d").
  accessTtl:
    clean(process.env.ACCESS_TOKEN_TTL) ||
    (clean(process.env.NODE_ENV) === 'production' ? '15m' : '30d'),
  mongoUri: usableMongo,
  redisUrl: usableRedis,
  agentsServiceUrl: clean(process.env.AGENTS_SERVICE_URL),
  defaultLocale: clean(process.env.DEFAULT_LOCALE) || 'en',
  isTest: process.env.NODE_ENV === 'test' || Boolean(process.env.VITEST),
};
