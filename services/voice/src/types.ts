import type { CallOutcome, Locale } from '@truecode/shared';

export interface VoiceCallRequest {
  /** Our internal Call id — echoed back in events. */
  callRef: string;
  to: string;
  agentKey: string;
  locale: Locale;
  /** Script with {{merge}} fields already resolved by the API. */
  resolvedScript: string[];
  voiceId: string;
  tools: string[];
  transferRule: string;
  /** Account persona/instructions appended to the agent's system prompt. */
  systemPrompt?: string;
  /** Retrieved knowledge-base context (RAG) the agent may cite on the call. */
  knowledge?: string;
  /** Opening line the agent speaks first. */
  firstMessage?: string;
  /** Per-agent pipeline overrides from the Agent Studio. */
  transcriber?: { provider: string; model?: string };
  model?: { provider: string; model?: string; temperature?: number };
  voice?: { provider: string; voiceId?: string };
  metadata?: Record<string, string>;
}

export interface TranscriptTurn {
  role: 'agent' | 'lead';
  text: string;
  ts: number;
}

export interface VoiceCallResult {
  callRef: string;
  providerCallId: string;
  status: 'completed' | 'failed';
  durationSec: number;
  transcript: TranscriptTurn[];
  summary: string;
  outcome: CallOutcome;
  recordingUrl?: string;
  /** Structured data the agent extracted (budget, timeline, requested slot…). */
  extracted: Record<string, string>;
}

export type CallEventHandler = (result: VoiceCallResult) => Promise<void>;

/**
 * VoiceProvider — the ONLY surface business logic may touch.
 * Adapters: dograh (default self-host), gemini-live, vapi, mock.
 */
export interface VoiceProvider {
  readonly name: string;
  readonly live: boolean;
  readonly reason?: string;
  startOutboundCall(req: VoiceCallRequest): Promise<{ providerCallId: string }>;
  /** Register the single handler invoked when a call finishes. */
  onCallComplete(handler: CallEventHandler): void;
}
