import { envVal, forceMock, mockResult, type ProviderInfo, type SendResult } from './base.js';

export class ResendClient {
  private get key() {
    return envVal('RESEND_API_KEY');
  }
  private get from() {
    return envVal('RESEND_FROM_EMAIL') || 'CloseFlow <noreply@closeflow.io>';
  }

  get info(): ProviderInfo {
    return {
      name: 'Resend',
      live: !forceMock() && Boolean(this.key),
      reason: forceMock() ? 'forced mock (tests)' : this.key ? undefined : 'RESEND_API_KEY missing',
    };
  }

  async sendEmail(to: string, subject: string, html: string): Promise<SendResult> {
    if (!this.info.live) return mockResult('email');
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [to], subject, html }),
      });
      const data = (await res.json()) as { id?: string; message?: string };
      if (!res.ok) return { ok: false, status: 'failed', error: data.message ?? `HTTP ${res.status}` };
      return { ok: true, id: data.id, status: 'sent' };
    } catch (e) {
      return { ok: false, status: 'failed', error: (e as Error).message };
    }
  }
}

export const resend = new ResendClient();
