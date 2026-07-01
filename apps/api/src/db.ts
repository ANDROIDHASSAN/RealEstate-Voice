import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

let memServer: { stop(): Promise<boolean> } | null = null;

export async function connectDb(): Promise<void> {
  if (env.mongoUri) {
    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
      logger.info('MongoDB connected (configured URI)');
      return;
    } catch (err) {
      // Never crash on a bad/missing key (PROMPT §17) — fall back, loudly.
      logger.error(
        { err: (err as Error).message },
        'MONGO_URI unreachable/malformed — falling back to in-memory MongoDB',
      );
    }
  } else {
    logger.warn('MONGO_URI empty — using in-memory MongoDB (data resets on restart)');
  }
  // Local dev / tests fallback: real mongod, in-memory (DECISIONS.md #2).
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create();
  memServer = server;
  await mongoose.connect(server.getUri('closeflow'));
  logger.info('MongoDB connected (in-memory)');
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
  if (memServer) await memServer.stop();
  memServer = null;
}
