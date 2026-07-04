import { envVal, forceMock, mockResult, type ProviderInfo, type SendResult } from './base.js';

/**
 * YouTube publishing adapter. Live mode inserts a video resource via the
 * YouTube Data API (`YOUTUBE_ACCESS_TOKEN`, an OAuth user token); mock mode
 * logs a labeled `[STUB]` line and returns `mock-sent`. Full byte upload is a
 * resumable flow the render/publish worker drives once bytes exist.
 */
export class YouTubeClient {
  private get token() {
    return envVal('YOUTUBE_ACCESS_TOKEN');
  }

  get info(): ProviderInfo {
    return {
      name: 'YouTube Data API',
      live: !forceMock() && Boolean(this.token),
      reason: forceMock()
        ? 'forced mock (tests)'
        : this.token
          ? undefined
          : 'YOUTUBE_ACCESS_TOKEN missing (Google OAuth pending)',
    };
  }

  async uploadVideo(opts: {
    title: string;
    description: string;
    videoUrl?: string;
    privacy?: 'public' | 'unlisted' | 'private';
    tags?: string[];
  }): Promise<SendResult> {
    if (!this.info.live) {
      console.info(`[STUB][youtube] would upload "${opts.title.slice(0, 60)}…" (${opts.privacy ?? 'public'})`);
      return mockResult('yt');
    }
    try {
      const res = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet,status', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snippet: { title: opts.title, description: opts.description, tags: opts.tags ?? [], categoryId: '22' },
          status: { privacyStatus: opts.privacy ?? 'public', selfDeclaredMadeForKids: false },
        }),
      });
      const json = (await res.json()) as { id?: string; error?: { message: string } };
      if (!res.ok || !json.id) return { ok: false, status: 'failed', error: json.error?.message ?? 'youtube insert failed' };
      return { ok: true, id: json.id, status: 'sent' };
    } catch (e) {
      return { ok: false, status: 'failed', error: (e as Error).message };
    }
  }
}

export const youtube = new YouTubeClient();
