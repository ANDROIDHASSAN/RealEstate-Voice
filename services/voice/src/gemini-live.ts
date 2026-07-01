import type { CallEventHandler, VoiceCallRequest, VoiceProvider } from './types.js';

/**
 * Gemini Live adapter. Gemini Live is a realtime WebSocket API — the full
 * telephony bridge (Twilio Media Streams <-> Gemini Live) runs in
 * services/agents when deployed. This adapter starts that bridge via HTTP.
 */
export class GeminiLiveVoiceProvider implements VoiceProvider {
  readonly name = 'gemini-live';
  private apiKey = process.env.GEMINI_LIVE_API_KEY ?? '';
  private bridgeUrl = process.env.AGENTS_SERVICE_URL ?? '';
  private handler: CallEventHandler | null = null;

  get live(): boolean {
    return Boolean(this.apiKey && this.bridgeUrl);
  }
  get reason(): string | undefined {
    return this.apiKey ? undefined : 'GEMINI_LIVE_API_KEY missing';
  }

  onCallComplete(handler: CallEventHandler): void {
    this.handler = handler;
  }

  async deliverWebhookEvent(result: Parameters<CallEventHandler>[0]): Promise<void> {
    await this.handler?.(result);
  }

  async startOutboundCall(req: VoiceCallRequest): Promise<{ providerCallId: string }> {
    const res = await fetch(`${this.bridgeUrl}/voice/gemini-live/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: req.to,
        locale: req.locale,
        script: req.resolvedScript,
        voice: req.voiceId,
        callRef: req.callRef,
      }),
    });
    if (!res.ok) throw new Error(`Gemini Live bridge HTTP ${res.status}`);
    const data = (await res.json()) as { callId: string };
    return { providerCallId: data.callId };
  }
}
