import { envVal, forceMock, mockResult, type ProviderInfo, type SendResult } from './base.js';

/**
 * Facebook Pages publishing adapter. Live mode posts to a Page feed/photos via
 * the Graph API (`FB_PAGE_ACCESS_TOKEN` + `FB_PAGE_ID`); mock mode logs a
 * labeled `[STUB]` line and returns `mock-sent`.
 */
export class FacebookClient {
  private get token() {
    return envVal('FB_PAGE_ACCESS_TOKEN');
  }
  private get pageId() {
    return envVal('FB_PAGE_ID');
  }

  get info(): ProviderInfo {
    const live = !forceMock() && Boolean(this.token && this.pageId);
    return {
      name: 'Facebook Pages API',
      live,
      reason: forceMock()
        ? 'forced mock (tests)'
        : live
          ? undefined
          : 'FB_PAGE_ACCESS_TOKEN / FB_PAGE_ID missing (pending Meta App Review)',
    };
  }

  async publishPost(message: string, mediaUrl?: string): Promise<SendResult> {
    if (!this.info.live) {
      console.info(`[STUB][facebook] would publish to Page: "${message.slice(0, 60)}…" media=${mediaUrl ?? 'none'}`);
      return mockResult('fb');
    }
    try {
      const endpoint = mediaUrl
        ? `https://graph.facebook.com/v20.0/${this.pageId}/photos`
        : `https://graph.facebook.com/v20.0/${this.pageId}/feed`;
      const body = mediaUrl
        ? { url: mediaUrl, caption: message, access_token: this.token }
        : { message, access_token: this.token };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { id?: string; post_id?: string; error?: { message: string } };
      const id = json.post_id ?? json.id;
      if (!res.ok || !id) return { ok: false, status: 'failed', error: json.error?.message ?? 'facebook publish failed' };
      return { ok: true, id, status: 'sent' };
    } catch (e) {
      return { ok: false, status: 'failed', error: (e as Error).message };
    }
  }
}

export const facebook = new FacebookClient();
