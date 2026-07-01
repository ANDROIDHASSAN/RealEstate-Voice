import { envVal, forceMock, mockResult, type ProviderInfo, type SendResult } from './base.js';

/** GoHighLevel sync (optional per client). Mock mode logs intent only. */
export class GhlClient {
  private get clientId() {
    return envVal('GHL_CLIENT_ID');
  }
  private get clientSecret() {
    return envVal('GHL_CLIENT_SECRET');
  }

  get info(): ProviderInfo {
    return {
      name: 'GoHighLevel',
      live: !forceMock() && Boolean(this.clientId && this.clientSecret),
      reason: forceMock() ? 'forced mock (tests)' : this.clientId ? undefined : 'GHL_CLIENT_ID missing',
    };
  }

  async upsertContact(
    apiKey: string,
    locationId: string,
    contact: { firstName: string; lastName?: string; phone?: string; email?: string },
  ): Promise<SendResult> {
    if (!apiKey || !locationId) return mockResult('ghl');
    try {
      const res = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...contact, locationId }),
      });
      const data = (await res.json()) as { contact?: { id?: string }; message?: string };
      if (!res.ok) return { ok: false, status: 'failed', error: data.message ?? `HTTP ${res.status}` };
      return { ok: true, id: data.contact?.id, status: 'sent' };
    } catch (e) {
      return { ok: false, status: 'failed', error: (e as Error).message };
    }
  }
}

export const ghl = new GhlClient();
