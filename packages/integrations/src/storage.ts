import { envVal, forceMock, type ProviderInfo } from './base.js';

export interface StoredFile {
  url: string;
  stub: boolean;
}

/**
 * Media storage adapter for the Content Studio media library. Live mode uploads
 * to Vercel Blob (`BLOB_READ_WRITE_TOKEN`) or Cloudinary (`CLOUDINARY_URL`);
 * mock mode echoes the bytes back as a data URL so the asset still renders in
 * the UI end-to-end — clearly flagged `stub:true`, never fake-functional.
 */
export class StorageClient {
  private get blobToken() {
    return envVal('BLOB_READ_WRITE_TOKEN');
  }
  private get cloudinary() {
    return envVal('CLOUDINARY_URL');
  }
  private get key() {
    return this.blobToken || this.cloudinary;
  }

  get info(): ProviderInfo {
    return {
      name: this.blobToken ? 'Vercel Blob' : this.cloudinary ? 'Cloudinary' : 'Media storage',
      live: !forceMock() && Boolean(this.key),
      reason: forceMock()
        ? 'forced mock (tests)'
        : this.key
          ? undefined
          : 'BLOB_READ_WRITE_TOKEN / CLOUDINARY_URL missing',
    };
  }

  async save(opts: { name: string; contentType: string; dataBase64: string }): Promise<StoredFile> {
    if (!this.info.live) {
      // Mock storage — inline the asset as a data URL so it renders immediately.
      return { url: `data:${opts.contentType};base64,${opts.dataBase64}`, stub: true };
    }
    if (this.blobToken) {
      const buf = Buffer.from(opts.dataBase64, 'base64');
      const res = await fetch(`https://blob.vercel-storage.com/${encodeURIComponent(opts.name)}`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${this.blobToken}`,
          'x-content-type': opts.contentType,
          'x-api-version': '7',
        },
        body: buf,
      });
      if (!res.ok) throw new Error(`Blob HTTP ${res.status}`);
      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error('Blob upload returned no url');
      return { url: json.url, stub: false };
    }
    // Cloudinary signed upload isn't wired server-side here — inline as stub.
    return { url: `data:${opts.contentType};base64,${opts.dataBase64}`, stub: true };
  }
}

export const storage = new StorageClient();
