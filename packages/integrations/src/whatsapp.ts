import { envVal, forceMock, mockResult, type ProviderInfo, type SendResult } from './base.js';

export class WhatsAppClient {
  private get token() {
    return envVal('WHATSAPP_TOKEN');
  }
  private get phoneId() {
    return envVal('WHATSAPP_PHONE_ID');
  }

  get info(): ProviderInfo {
    return {
      name: 'WhatsApp Cloud API',
      live: !forceMock() && Boolean(this.token && this.phoneId),
      reason: forceMock() ? 'forced mock (tests)' : this.token ? undefined : 'WHATSAPP_TOKEN missing',
    };
  }

  async sendText(to: string, body: string): Promise<SendResult> {
    if (!this.info.live) return mockResult('wa');
    try {
      const res = await fetch(`https://graph.facebook.com/v20.0/${this.phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      });
      const data = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
      if (!res.ok) return { ok: false, status: 'failed', error: data.error?.message ?? `HTTP ${res.status}` };
      return { ok: true, id: data.messages?.[0]?.id, status: 'sent' };
    } catch (e) {
      return { ok: false, status: 'failed', error: (e as Error).message };
    }
  }
}

export const whatsapp = new WhatsAppClient();
