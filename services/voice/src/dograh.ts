import type { CallEventHandler, VoiceCallRequest, VoiceProvider } from './types.js';

/**
 * Dograh adapter — default provider (self-hosted, no platform fee).
 * Talks to a deployed Dograh instance at DOGRAH_BASE_URL. Completion events
 * arrive via the API's /webhook/voice/dograh endpoint, which forwards them
 * to the registered handler.
 */
export class DograhVoiceProvider implements VoiceProvider {
  readonly name = 'dograh';
  private baseUrl = (process.env.DOGRAH_BASE_URL ?? '').replace(/\s+#.*$/, '').trim();
  private apiKey = (process.env.DOGRAH_API_KEY ?? '').replace(/\s+#.*$/, '').trim();
  private handler: CallEventHandler | null = null;

  get live(): boolean {
    return Boolean(this.baseUrl);
  }
  get reason(): string | undefined {
    return this.baseUrl ? undefined : 'DOGRAH_BASE_URL missing';
  }

  onCallComplete(handler: CallEventHandler): void {
    this.handler = handler;
  }

  /** Called by the API's Dograh webhook route to deliver completion events. */
  async deliverWebhookEvent(result: Parameters<CallEventHandler>[0]): Promise<void> {
    await this.handler?.(result);
  }

  async startOutboundCall(req: VoiceCallRequest): Promise<{ providerCallId: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/calls`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: req.to,
        voice: req.voiceId,
        language: req.locale,
        script: req.resolvedScript,
        tools: req.tools,
        transfer_rule: req.transferRule,
        metadata: { ...req.metadata, callRef: req.callRef },
      }),
    });
    if (!res.ok) throw new Error(`Dograh HTTP ${res.status}`);
    const data = (await res.json()) as { call_id: string };
    return { providerCallId: data.call_id };
  }
}
