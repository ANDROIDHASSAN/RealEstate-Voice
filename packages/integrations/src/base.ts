/**
 * Sanitize an env value: strip inline comments (` # …`) and whitespace;
 * comment-only placeholders count as unset.
 */
export function envVal(name: string): string {
  const raw = process.env[name];
  if (!raw) return '';
  const trimmed = raw.replace(/\s+#.*$/, '').trim();
  return trimmed.startsWith('#') ? '' : trimmed;
}

/**
 * FORCE_MOCK_PROVIDERS=1 forces every integration into mock mode — used by
 * tests/acceptance so real keys never place real calls/SMS at test numbers.
 */
export function forceMock(): boolean {
  return process.env.FORCE_MOCK_PROVIDERS === '1';
}

export interface SendResult {
  ok: boolean;
  id?: string;
  status: 'sent' | 'mock-sent' | 'failed';
  error?: string;
}

export function mockResult(prefix: string): SendResult {
  return { ok: true, id: `${prefix}_mock_${Math.random().toString(36).slice(2, 10)}`, status: 'mock-sent' };
}

/** Every integration reports whether it's running live or in mock mode. */
export interface ProviderInfo {
  name: string;
  live: boolean;
  reason?: string;
}
