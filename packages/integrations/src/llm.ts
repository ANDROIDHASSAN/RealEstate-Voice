import { envVal, forceMock, type ProviderInfo } from './base.js';

export interface LLMCompleteOptions {
  system?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
}

/** LLMProvider — business logic only ever sees this interface. */
export interface LLMProvider {
  readonly info: ProviderInfo;
  complete(prompt: string, opts?: LLMCompleteOptions): Promise<string>;
}

// Default models per provider — overridable from Settings (env var per provider).
const DEFAULT_MODELS = {
  gemini: 'gemini-2.0-flash',
  groq: 'llama-3.3-70b-versatile',
  openai: 'gpt-4o-mini',
} as const;

class GeminiProvider implements LLMProvider {
  private get key() {
    return envVal('GEMINI_API_KEY');
  }
  private get model() {
    return envVal('GEMINI_MODEL') || DEFAULT_MODELS.gemini;
  }
  get info(): ProviderInfo {
    return { name: `Gemini (${this.model})`, live: !forceMock() && Boolean(this.key), reason: this.key ? undefined : 'GEMINI_API_KEY missing' };
  }
  async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: opts?.system ? { parts: [{ text: opts.system }] } : undefined,
          generationConfig: {
            maxOutputTokens: opts?.maxTokens ?? 1024,
            temperature: opts?.temperature ?? 0.7,
            responseMimeType: opts?.json ? 'application/json' : undefined,
          },
        }),
      },
    );
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }
}

/** OpenAI-compatible chat provider — used by both OpenAI and Groq (same API shape). */
class OpenAICompatProvider implements LLMProvider {
  constructor(
    private opts: {
      label: string;
      keyVar: string;
      modelVar: string;
      defaultModel: string;
      baseUrl: string;
    },
  ) {}
  private get key() {
    return envVal(this.opts.keyVar);
  }
  private get model() {
    return envVal(this.opts.modelVar) || this.opts.defaultModel;
  }
  get info(): ProviderInfo {
    return {
      name: `${this.opts.label} (${this.model})`,
      live: !forceMock() && Boolean(this.key),
      reason: this.key ? undefined : `${this.opts.keyVar} missing`,
    };
  }
  async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
    const res = await fetch(this.opts.baseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0.7,
        response_format: opts?.json ? { type: 'json_object' } : undefined,
      }),
    });
    if (!res.ok) throw new Error(`${this.opts.label} HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

const makeGroq = () =>
  new OpenAICompatProvider({
    label: 'Groq',
    keyVar: 'GROQ_API_KEY',
    modelVar: 'GROQ_MODEL',
    defaultModel: DEFAULT_MODELS.groq,
    baseUrl: 'https://api.groq.com/openai/v1/chat/completions',
  });

const makeOpenAI = () =>
  new OpenAICompatProvider({
    label: 'OpenAI',
    keyVar: 'OPENAI_API_KEY',
    modelVar: 'OPENAI_MODEL',
    defaultModel: DEFAULT_MODELS.openai,
    baseUrl: 'https://api.openai.com/v1/chat/completions',
  });

/**
 * [MOCK] Deterministic template LLM used when no key is configured.
 * Honest: outputs are clearly labeled as mock-generated in the UI badge,
 * but they are usable, contextual templates — not lorem ipsum.
 */
class MockLLMProvider implements LLMProvider {
  get info(): ProviderInfo {
    return { name: 'Mock LLM', live: false, reason: 'No LLM key set (Gemini / Groq / OpenAI)' };
  }
  async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
    if (opts?.json) {
      return JSON.stringify({ mock: true, note: 'Set a Gemini, Groq or OpenAI key for live AI output.' });
    }
    const firstLine = prompt.split('\n').find((l) => l.trim().length > 0) ?? '';
    return `Thanks for reaching out! A member of our team will follow up shortly. (Mock AI reply — context: "${firstLine.slice(0, 80)}")`;
  }
}

type ProviderKey = 'gemini' | 'groq' | 'openai';

/**
 * Fallback chain across all live providers, ordered by the account's preferred
 * provider (LLM_PROVIDER = auto|gemini|groq|openai), landing on the mock only
 * when all fail. A single bad key never breaks AI features.
 */
class FallbackLLMProvider implements LLMProvider {
  private mock = new MockLLMProvider();

  private ordered(): { key: ProviderKey; provider: LLMProvider }[] {
    const all: { key: ProviderKey; provider: LLMProvider }[] = [
      { key: 'gemini', provider: new GeminiProvider() },
      { key: 'groq', provider: makeGroq() },
      { key: 'openai', provider: makeOpenAI() },
    ];
    const pref = (envVal('LLM_PROVIDER') || 'auto').toLowerCase() as ProviderKey | 'auto';
    if (pref === 'auto') return all;
    return [...all.filter((c) => c.key === pref), ...all.filter((c) => c.key !== pref)];
  }

  get info(): ProviderInfo {
    return this.ordered().find((c) => c.provider.info.live)?.provider.info ?? this.mock.info;
  }

  async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
    for (const { provider } of this.ordered()) {
      if (!provider.info.live) continue;
      try {
        const out = await provider.complete(prompt, opts);
        if (out.trim()) return out;
      } catch {
        // try the next provider
      }
    }
    return this.mock.complete(prompt, opts);
  }
}

/** Always returns a working provider (never throws on missing/bad keys). */
export function getLLM(): LLMProvider {
  return new FallbackLLMProvider();
}
