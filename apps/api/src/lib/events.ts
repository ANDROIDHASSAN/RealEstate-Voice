import { EventEmitter } from 'node:events';

/**
 * Per-account agent activity bus. Powers the live "agents working" UI:
 * workers/routes emit events here; the SSE stream + /events/recent read them.
 * In-memory by design (single instance); the ring buffer survives page loads
 * within a process, and Mongo AgentRun remains the durable record.
 */

export type AgentEventType =
  | 'agent:start'
  | 'agent:step'
  | 'agent:done'
  | 'agent:error'
  | 'outbound'
  | 'scrape'
  | 'call'
  | 'assistant';

export interface AgentEvent {
  id: string;
  accountId: string;
  type: AgentEventType;
  /** Which agent (voice/crew key) or subsystem produced this. */
  agentKey: string;
  title: string;
  detail?: string;
  status?: 'running' | 'done' | 'error' | 'blocked';
  ts: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(200);

const RING_SIZE = 200;
const recent = new Map<string, AgentEvent[]>();
let seq = 0;

export function emitAgentEvent(
  accountId: string,
  event: Omit<AgentEvent, 'id' | 'accountId' | 'ts'>,
): AgentEvent {
  const full: AgentEvent = {
    ...event,
    id: `ev_${Date.now().toString(36)}_${(seq += 1)}`,
    accountId,
    ts: new Date().toISOString(),
  };
  const buf = recent.get(accountId) ?? [];
  buf.push(full);
  if (buf.length > RING_SIZE) buf.splice(0, buf.length - RING_SIZE);
  recent.set(accountId, buf);
  try {
    // emit() runs subscribers synchronously — a broken SSE socket must never
    // crash the worker job that emitted the event.
    bus.emit(`account:${accountId}`, full);
  } catch {
    /* subscriber error — event already buffered */
  }
  return full;
}

export function recentAgentEvents(accountId: string, limit = 50): AgentEvent[] {
  const buf = recent.get(accountId) ?? [];
  return buf.slice(-limit).reverse();
}

export function subscribeAgentEvents(
  accountId: string,
  handler: (event: AgentEvent) => void,
): () => void {
  const channel = `account:${accountId}`;
  bus.on(channel, handler);
  return () => bus.off(channel, handler);
}
