/** Exact fallback requested for unavailable public quotes. */
export const FALLBACK_QUOTE = '\u4e0d\u8bf1\u4e8e\u8a89\uff0c\u4e0d\u6050\u4e8e\u8bfd\u3002';

/** Greeting follows the Windows user's local clock, not UTC. */
export function greeting(hour: number, username: string): string {
  const word = hour < 5 ? '\u591c\u6df1\u4e86' : hour < 11 ? '\u65e9\u4e0a\u597d'
    : hour < 13 ? '\u4e2d\u5348\u597d' : hour < 18 ? '\u4e0b\u5348\u597d' : '\u665a\u4e0a\u597d';
  return `${word}\uff0c${username}`;
}

/** Bound display text by code points without splitting surrogate pairs. */
export function compact(text: string, limit: number): string {
  const chars = Array.from(text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim());
  return chars.length > limit ? chars.slice(0, limit - 1).join('') + '\u2026' : chars.join('');
}

/** Fetch just the sentence. Author/source fields never reach the Toast. */
export async function fetchQuote(
  url: string, timeoutMs: number, signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<string> {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  try {
    const response = await request(url, { signal: deadline, headers: { Accept: 'application/json' } });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty Hitokoto response');
    let raw = '';
    let bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16384) throw new Error('Hitokoto response too large');
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { await reader.cancel(); reader.releaseLock(); }
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !('hitokoto' in data)
      || typeof data.hitokoto !== 'string' || !data.hitokoto.trim()) {
      throw new Error('Hitokoto returned no sentence');
    }
    return compact(data.hitokoto, 96);
  } catch {
    signal.throwIfAborted();
    return FALLBACK_QUOTE;
  }
}
