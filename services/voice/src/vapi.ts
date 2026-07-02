import type { CallEventHandler, VoiceCallRequest, VoiceProvider } from './types.js';

const env = (name: string, fallback: string): string =>
  ((process.env[name] ?? '').replace(/\s+#.*$/, '').trim() || fallback);

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
          firstMessage: req.firstMessage ?? req.resolvedScript[0],
          // Per-agent config (Agent Studio) wins; account-level env is the
          // fallback; sensible defaults keep it working with neither.
          model: {
            provider: req.model?.provider ?? env('VOICE_LLM_PROVIDER', 'groq'),
            model: req.model?.model ?? env('VOICE_LLM_MODEL', 'llama-3.3-70b-versatile'),
            temperature: req.model?.temperature,
            systemPrompt: [
              'You are a real-estate assistant.',
              req.systemPrompt ? `\nAgent instructions:\n${req.systemPrompt}` : '',
              req.knowledge ? `\nUse ONLY these facts about the business when relevant (do not invent):\n${req.knowledge}` : '',
              `\nFollow this script:\n${req.resolvedScript.join('\n')}`,
              `\nTransfer rule: ${req.transferRule}`,
            ].join(''),
          },
          voice: {
            provider: req.voice?.provider ?? env('VOICE_TTS_PROVIDER', '11labs'),
            voiceId: req.voice?.voiceId ?? env('VOICE_TTS_VOICE', req.voiceId),
          },
          transcriber: {
            provider: req.transcriber?.provider ?? env('VOICE_STT_PROVIDER', 'deepgram'),
            ...(req.transcriber?.model ? { model: req.transcriber.model } : {}),
          },
        },
        metadata: { ...req.metadata, callRef: req.callRef },
      }),
    });
    if (!res.ok) throw new Error(`Vapi HTTP ${res.status}`);
    const data = (await res.json()) as { id: string };
    return { providerCallId: data.id };
  }
}
