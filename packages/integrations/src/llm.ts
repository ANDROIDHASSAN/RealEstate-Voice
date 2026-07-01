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

class GeminiProvider implements LLMProvider {
  private get key() {
    return envVal('GEMINI_API_KEY');
  }
  get info(): ProviderInfo {
    return { name: 'Gemini', live: !forceMock() && Boolean(this.key), reason: this.key ? undefined : 'GEMINI_API_KEY missing' };
  }
  async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.key}`,
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

class GroqProvider implements LLMProvider {
  private get key() {
    return envVal('GROQ_API_KEY');
  }
  get info(): ProviderInfo {
    return { name: 'Groq', live: !forceMock() && Boolean(this.key), reason: this.key ? undefined : 'GROQ_API_KEY missing' };
  }
  async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          ...(opts?.system ? [{ role: 'system', content: opts.system }] : []),
          { role: 'user', content: prompt },
        ],
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0.7,
        response_format: opts?.json ? { type: 'json_object' } : undefined,
      }),
    });
    if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
}

/**
 * [MOCK] Deterministic template LLM used when no key is configured.
 * Honest: outputs are clearly labeled as mock-generated in the UI badge,
 * but they are usable, contextual templates — not lorem ipsum.
 */
class MockLLMProvider implements LLMProvider {
  get info(): ProviderInfo {
    return { name: 'Mock LLM', live: false, reason: 'No LLM key set (GEMINI_API_KEY / GROQ_API_KEY)' };
  }
  async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
    if (opts?.json) {
      return JSON.stringify({ mock: true, note: 'Set GEMINI_API_KEY or GROQ_API_KEY for live AI output.' });
    }
    // Simple contextual echo used by auto-reply flows in mock mode.
    const firstLine = prompt.split('\n').find((l) => l.trim().length > 0) ?? '';
    return `Thanks for reaching out! A member of our team will follow up shortly. (Mock AI reply — context: "${firstLine.slice(0, 80)}")`;
  }
}

/**
 * Fallback chain: tries each live provider in order (Gemini → Groq), landing
 * on the mock only when all fail. A single bad key never breaks AI features.
 */
class FallbackLLMProvider implements LLMProvider {
  private candidates: LLMProvider[] = [new GeminiProvider(), new GroqProvider()];
  private mock = new MockLLMProvider();

  get info(): ProviderInfo {
    return this.candidates.find((c) => c.info.live)?.info ?? this.mock.info;
  }

  async complete(prompt: string, opts?: LLMCompleteOptions): Promise<string> {
    for (const provider of this.candidates) {
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
