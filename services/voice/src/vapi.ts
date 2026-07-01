import type { CallEventHandler, VoiceCallRequest, VoiceProvider } from './types.js';

/** Vapi adapter (optional fallback). Completion via /webhook/voice/vapi. */
export class VapiVoiceProvider implements VoiceProvider {
  readonly name = 'vapi';
  private apiKey = (process.env.VAPI_API_KEY ?? '').replace(/\s+#.*$/, '').trim();
  private handler: CallEventHandler | null = null;

  get live(): boolean {
    return Boolean(this.apiKey);
  }
  get reason(): string | undefined {
    return this.apiKey ? undefined : 'VAPI_API_KEY missing';
  }

  onCallComplete(handler: CallEventHandler): void {
    this.handler = handler;
  }

  async deliverWebhookEvent(result: Parameters<CallEventHandler>[0]): Promise<void> {
    await this.handler?.(result);
  }

  async startOutboundCall(req: VoiceCallRequest): Promise<{ providerCallId: string }> {
    const res = await fetch('https://api.vapi.ai/call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: { number: req.to },
        assistant: {
          firstMessage: req.resolvedScript[0],
          model: {
            provider: 'groq',
            model: 'llama-3.3-70b-versatile',
            systemPrompt: `You are a real-estate assistant. Follow this script:\n${req.resolvedScript.join('\n')}\nTransfer rule: ${req.transferRule}`,
          },
          voice: { provider: '11labs', voiceId: req.voiceId },
        },
        metadata: { ...req.metadata, callRef: req.callRef },
      }),
    });
    if (!res.ok) throw new Error(`Vapi HTTP ${res.status}`);
    const data = (await res.json()) as { id: string };
    return { providerCallId: data.id };
  }
}
