import { env } from '../env.js';
import { logger } from '../logger.js';

export interface JobOptions {
  /** Delay before processing, ms. */
  delayMs?: number;
  attempts?: number;
  jobId?: string;
}

export type JobHandler = (data: Record<string, unknown>) => Promise<void>;

/**
 * QueueProvider — business logic only sees enqueue/process.
 * InMemory when REDIS_URL is empty (DECISIONS.md #2), BullMQ when set.
 */
export interface QueueProvider {
  readonly name: string;
  enqueue(queue: string, data: Record<string, unknown>, opts?: JobOptions): Promise<void>;
  process(queue: string, handler: JobHandler): void;
  /** Number of jobs not yet completed (for tests/health). */
  pending(queue: string): Promise<number>;
  close(): Promise<void>;
}

class InMemoryQueueProvider implements QueueProvider {
  readonly name = 'in-memory';
  private handlers = new Map<string, JobHandler>();
  private waiting = new Map<string, Record<string, unknown>[]>();
  private counts = new Map<string, number>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private seenJobIds = new Set<string>();

  async enqueue(queue: string, data: Record<string, unknown>, opts?: JobOptions): Promise<void> {
    if (opts?.jobId) {
      if (this.seenJobIds.has(`${queue}:${opts.jobId}`)) return; // dedup
      this.seenJobIds.add(`${queue}:${opts.jobId}`);
    }
    this.counts.set(queue, (this.counts.get(queue) ?? 0) + 1);
    const run = () => {
      const handler = this.handlers.get(queue);
      if (!handler) {
        // Handler not registered yet — park the job.
        const list = this.waiting.get(queue) ?? [];
        list.push(data);
        this.waiting.set(queue, list);
        this.counts.set(queue, (this.counts.get(queue) ?? 1) - 1);
        return;
      }
      void this.execute(queue, handler, data, opts?.attempts ?? 3);
    };
    if (opts?.delayMs && opts.delayMs > 0) {
      const t = setTimeout(() => {
        this.timers.delete(t);
        run();
      }, opts.delayMs);
      // Don't hold the process open for far-future drip steps.
      t.unref?.();
      this.timers.add(t);
    } else {
      setImmediate(run);
    }
  }

  private decrement(queue: string): void {
    this.counts.set(queue, Math.max(0, (this.counts.get(queue) ?? 1) - 1));
  }

  private async execute(
    queue: string,
    handler: JobHandler,
    data: Record<string, unknown>,
    attemptsLeft: number,
  ): Promise<void> {
    try {
      await handler(data);
      this.decrement(queue);
    } catch (err) {
      logger.error({ queue, err: (err as Error).message }, 'job failed');
      if (attemptsLeft > 1) {
        setTimeout(() => void this.execute(queue, handler, data, attemptsLeft - 1), 500);
      } else {
        this.decrement(queue);
      }
    }
  }

  process(queue: string, handler: JobHandler): void {
    this.handlers.set(queue, handler);
    const parked = this.waiting.get(queue) ?? [];
    this.waiting.delete(queue);
    for (const data of parked) {
      this.counts.set(queue, (this.counts.get(queue) ?? 0) + 1);
      void this.execute(queue, handler, data, 3);
    }
  }

  async pending(queue: string): Promise<number> {
    return this.counts.get(queue) ?? 0;
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
}

/** Parse a redis:// or rediss:// URL into BullMQ connection options. */
function redisOptions(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

class BullMQQueueProvider implements QueueProvider {
  readonly name = 'bullmq';
  private queues = new Map<string, import('bullmq').Queue>();
  private workers: import('bullmq').Worker[] = [];

  private async q(name: string): Promise<import('bullmq').Queue> {
    let existing = this.queues.get(name);
    if (!existing) {
      const { Queue } = await import('bullmq');
      existing = new Queue(name, { connection: redisOptions(env.redisUrl) });
      this.queues.set(name, existing);
    }
    return existing;
  }

  async enqueue(queue: string, data: Record<string, unknown>, opts?: JobOptions): Promise<void> {
    const q = await this.q(queue);
    await q.add(queue, data, {
      delay: opts?.delayMs,
      attempts: opts?.attempts ?? 3,
      backoff: { type: 'exponential', delay: 1000 },
      jobId: opts?.jobId,
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  process(queue: string, handler: JobHandler): void {
    void (async () => {
      const { Worker } = await import('bullmq');
      const worker = new Worker(
        queue,
        async (job) => handler(job.data as Record<string, unknown>),
        { connection: redisOptions(env.redisUrl), concurrency: 10 },
      );
      worker.on('failed', (job, err) =>
        logger.error({ queue, jobId: job?.id, err: err.message }, 'job failed'),
      );
      this.workers.push(worker);
    })();
  }

  async pending(queue: string): Promise<number> {
    const q = await this.q(queue);
    const counts = await q.getJobCounts('waiting', 'delayed', 'active');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}

let provider: QueueProvider | null = null;

export function getQueue(): QueueProvider {
  if (!provider) {
    provider = env.redisUrl ? new BullMQQueueProvider() : new InMemoryQueueProvider();
    logger.info({ provider: provider.name }, 'queue provider ready');
  }
  return provider;
}

export async function closeQueue(): Promise<void> {
  await provider?.close();
  provider = null;
}

/** Queue names — single registry to avoid typos. */
export const QUEUES = {
  instantReply: 'instant-reply',
  voiceCall: 'voice-call',
  drip: 'drip-step',
  scrape: 'scrape-job',
  campaign: 'campaign-send',
  contentPublish: 'content-publish',
  videoRender: 'video-render',
  propertyAnalysis: 'property-analysis',
  adLaunch: 'ad-launch',
  adSync: 'ad-sync',
  eval: 'eval-run',
} as const;
