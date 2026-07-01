import { envVal, forceMock, type ProviderInfo } from './base.js';

/**
 * [STUB — external render API]
 * Video rendering adapter (Creatomate/Higgsfield-shaped). With no key, render()
 * returns a labeled placeholder render URL after simulating queue time, so the
 * M8 job pipeline (request → queue → render → deliver) is real end-to-end.
 */
export class VideoClient {
  private get key() {
    return envVal('CREATOMATE_API_KEY') || envVal('HIGGSFIELD_API_KEY');
  }

  get info(): ProviderInfo {
    return {
      name: 'Video Render (Creatomate/Higgsfield)',
      live: !forceMock() && Boolean(this.key),
      reason: this.key ? undefined : 'CREATOMATE_API_KEY / HIGGSFIELD_API_KEY missing',
    };
  }

  async render(spec: { title: string; script: string; templateId?: string }): Promise<{
    ok: boolean;
    renderUrl: string;
    stub: boolean;
  }> {
    if (!this.info.live) {
      console.info(`[STUB][video] would render "${spec.title}"`);
      return {
        ok: true,
        renderUrl: `https://placehold.co/1080x1920/E6DDF8/1A1A1A?text=${encodeURIComponent('[STUB RENDER] ' + spec.title)}`,
        stub: true,
      };
    }
    const res = await fetch('https://api.creatomate.com/v1/renders', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: spec.templateId,
        modifications: { Title: spec.title, Script: spec.script },
      }),
    });
    if (!res.ok) throw new Error(`Video API HTTP ${res.status}`);
    const data = (await res.json()) as { url?: string }[];
    return { ok: true, renderUrl: data[0]?.url ?? '', stub: false };
  }
}

export const video = new VideoClient();
