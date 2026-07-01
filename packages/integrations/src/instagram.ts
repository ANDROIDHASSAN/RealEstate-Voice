import { envVal, forceMock, mockResult, type ProviderInfo, type SendResult } from './base.js';

/**
 * [STUB — pending Meta App Review]
 * Instagram Graph API adapter. Publishing requires an approved Meta app with
 * instagram_content_publish. Until IG_ACCESS_TOKEN is present AND the app is
 * approved, publish() logs the intended action and returns a stub result.
 * The UI (content calendar, scheduler, DM framework) is fully functional now
 * and flips live when credentials land — no code changes needed.
 */
export class InstagramClient {
  private get token() {
    return envVal('IG_ACCESS_TOKEN');
  }

  get info(): ProviderInfo {
    return {
      name: 'Instagram Graph API',
      live: !forceMock() && Boolean(this.token),
      reason: this.token ? undefined : 'Pending Meta App Review (IG_ACCESS_TOKEN missing)',
    };
  }

  async publishPost(igUserId: string, caption: string, mediaUrl?: string): Promise<SendResult> {
    if (!this.info.live) {
      console.info(`[STUB][instagram] would publish post for ${igUserId}: "${caption.slice(0, 60)}..." media=${mediaUrl ?? 'none'}`);
      return mockResult('ig');
    }
    try {
      const createRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caption, image_url: mediaUrl, access_token: this.token }),
      });
      const container = (await createRes.json()) as { id?: string; error?: { message: string } };
      if (!createRes.ok || !container.id)
        return { ok: false, status: 'failed', error: container.error?.message ?? 'container failed' };
      const pubRes = await fetch(`https://graph.facebook.com/v20.0/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: container.id, access_token: this.token }),
      });
      const pub = (await pubRes.json()) as { id?: string; error?: { message: string } };
      if (!pubRes.ok) return { ok: false, status: 'failed', error: pub.error?.message ?? 'publish failed' };
      return { ok: true, id: pub.id, status: 'sent' };
    } catch (e) {
      return { ok: false, status: 'failed', error: (e as Error).message };
    }
  }
}

export const instagram = new InstagramClient();
