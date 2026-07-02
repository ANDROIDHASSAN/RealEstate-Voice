import { envVal, forceMock, type ProviderInfo } from './base.js';

/**
 * Embeddings provider for RAG. Live mode uses Gemini or OpenAI embedding
 * models; when no key is set, `embed()` returns null so the retriever falls
 * back to a keyword scorer (degraded but functional — never crashes).
 */
export interface EmbeddingsProvider {
  readonly info: ProviderInfo;
  /** Returns one vector per input, or null when running keyless (use keyword search). */
  embed(texts: string[]): Promise<number[][] | null>;
}

class GeminiEmbeddings implements EmbeddingsProvider {
  private get key() {
    return envVal('GEMINI_API_KEY');
  }
  private get model() {
    // gemini-embedding-001 is the current embedContent model (text-embedding-004
    // is not served on all keys). Overridable via EMBEDDINGS_MODEL.
    return envVal('EMBEDDINGS_MODEL') || 'gemini-embedding-001';
  }
  get info(): ProviderInfo {
    return { name: `Gemini (${this.model})`, live: !forceMock() && Boolean(this.key), reason: this.key ? undefined : 'GEMINI_API_KEY missing' };
  }
  async embed(texts: string[]): Promise<number[][]> {
    // These models expose embedContent (single), not batch — embed each chunk.
    const one = async (text: string): Promise<number[]> => {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.key}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: `models/${this.model}`, content: { parts: [{ text }] } }),
        },
      );
      if (!res.ok) throw new Error(`Gemini embeddings HTTP ${res.status}`);
      const data = (await res.json()) as { embedding?: { values: number[] } };
      return data.embedding?.values ?? [];
    };
    return Promise.all(texts.map(one));
  }
}

class OpenAIEmbeddings implements EmbeddingsProvider {
  private get key() {
    return envVal('OPENAI_API_KEY');
  }
  private get model() {
    return envVal('OPENAI_EMBEDDINGS_MODEL') || 'text-embedding-3-small';
  }
  get info(): ProviderInfo {
    return { name: `OpenAI (${this.model})`, live: !forceMock() && Boolean(this.key), reason: this.key ? undefined : 'OPENAI_API_KEY missing' };
  }
  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings HTTP ${res.status}`);
    const data = (await res.json()) as { data?: { embedding: number[] }[] };
    return (data.data ?? []).map((e) => e.embedding);
  }
}

/** No-key fallback — signals the retriever to use keyword matching. */
class KeywordFallbackEmbeddings implements EmbeddingsProvider {
  get info(): ProviderInfo {
    return { name: 'Keyword match (no embeddings key)', live: false, reason: 'Set GEMINI_API_KEY or OPENAI_API_KEY for semantic RAG' };
  }
  async embed(): Promise<null> {
    return null;
  }
}

class ChainedEmbeddings implements EmbeddingsProvider {
  private candidates = [new GeminiEmbeddings(), new OpenAIEmbeddings()];
  private fallback = new KeywordFallbackEmbeddings();

  private active(): EmbeddingsProvider {
    return this.candidates.find((c) => c.info.live) ?? this.fallback;
  }
  get info(): ProviderInfo {
    return this.active().info;
  }
  async embed(texts: string[]): Promise<number[][] | null> {
    for (const c of this.candidates) {
      if (!c.info.live) continue;
      try {
        return await c.embed(texts);
      } catch {
        // try next provider
      }
    }
    return null;
  }
}

export function getEmbeddings(): EmbeddingsProvider {
  return new ChainedEmbeddings();
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
