import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

let memServer: { stop(opts?: { doCleanup?: boolean }): Promise<boolean> } | null = null;

/**
 * Should the in-memory Mongo persist to disk across restarts?
 * On for local `npm run dev` (so your login + data survive a reload); OFF for
 * tests/acceptance/e2e (they force mock and need a clean, isolated DB each run).
 */
function shouldPersistLocalDb(): boolean {
  return process.env.NODE_ENV !== 'test' && process.env.FORCE_MOCK_PROVIDERS !== '1';
}

/** Stable on-disk location for the local dev database. */
function localDbPath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // apps/api/src -> repo root/.local-data/mongo
  return path.resolve(here, '../../../.local-data/mongo');
}

export async function connectDb(): Promise<void> {
  if (env.mongoUri) {
    try {
      // Fail fast (3s, not 8s) so a bad/placeholder URI doesn't stall boot and
      // leave the web dev-proxy throwing ECONNREFUSED at a not-yet-listening API.
      await mongoose.connect(env.mongoUri, {
        serverSelectionTimeoutMS: 3000,
        connectTimeoutMS: 3000,
      });
      logger.info('MongoDB connected (configured URI)');
      return;
    } catch (err) {
      // Never crash on a bad/missing key (PROMPT §17) — this is an EXPECTED,
      // recoverable fallback (e.g. the placeholder Atlas URI in .env), so log it
      // as a warning, not an error, and continue on local Mongo.
      logger.warn(
        { reason: (err as Error).message },
        'MONGO_URI not reachable — using local MongoDB instead (this is fine for local dev; set a valid MONGO_URI for a shared/cloud DB)',
      );
    }
  } else {
    logger.info('MONGO_URI not set — using local MongoDB (fine for local dev)');
  }

  // Local dev / tests fallback: real mongod (in-memory binary), optionally
  // persisted to disk so a restart keeps your session + data (DECISIONS.md #2).
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const persist = shouldPersistLocalDb();

  // Give mongod up to 30s to start — cold starts on a busy CI/dev box can
  // exceed the 10s default and spuriously fail the whole boot/test run.
  const instance: Record<string, unknown> = { launchTimeout: 30_000 };
  if (persist) {
    const dbPath = localDbPath();
    mkdirSync(dbPath, { recursive: true });
    // A hard-killed mongod (e.g. tsx watch reload) can leave a stale lock that
    // blocks the next start. Single-instance dev — safe to clear it.
    const lock = path.join(dbPath, 'mongod.lock');
    if (existsSync(lock)) {
      try {
        rmSync(lock);
      } catch {
        /* best effort */
      }
    }
    instance.dbPath = dbPath;
    instance.storageEngine = 'wiredTiger';
  }

  const server = await MongoMemoryServer.create({ instance });
  memServer = server;
  await mongoose.connect(server.getUri('truecode'));
  logger.info({ persisted: persist }, persist ? 'MongoDB connected (local, persisted to disk)' : 'MongoDB connected (in-memory)');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  // Keep the on-disk data when persisting; only clean up ephemeral test DBs.
  if (memServer) await memServer.stop({ doCleanup: !shouldPersistLocalDb() });
  memServer = null;
}
