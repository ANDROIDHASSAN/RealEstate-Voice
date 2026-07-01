import { DograhVoiceProvider } from './dograh.js';
import { GeminiLiveVoiceProvider } from './gemini-live.js';
import { MockVoiceProvider } from './mock.js';
import type { VoiceProvider } from './types.js';
import { VapiVoiceProvider } from './vapi.js';

export * from './types.js';
export { DograhVoiceProvider, GeminiLiveVoiceProvider, MockVoiceProvider, VapiVoiceProvider };

let singleton: VoiceProvider | null = null;

/**
 * Resolve the active provider from VOICE_PROVIDER env, falling back to mock
 * when the configured provider has no credentials (never crash on missing key).
 */
export function getVoiceProvider(): VoiceProvider {
  if (singleton) return singleton;
  if (process.env.FORCE_MOCK_PROVIDERS === '1') {
    singleton = new MockVoiceProvider();
    return singleton;
  }
  const wanted = (process.env.VOICE_PROVIDER ?? 'dograh')
    .replace(/\s+#.*$/, '')
    .trim()
    .toLowerCase();
  const candidates: Record<string, () => VoiceProvider> = {
    dograh: () => new DograhVoiceProvider(),
    'gemini-live': () => new GeminiLiveVoiceProvider(),
    vapi: () => new VapiVoiceProvider(),
    mock: () => new MockVoiceProvider(),
  };
  const make = candidates[wanted] ?? candidates.dograh!;
  const provider = make();
  singleton = provider.live ? provider : new MockVoiceProvider();
  return singleton;
}

/** Test hook. */
export function resetVoiceProvider(): void {
  singleton = null;
}
