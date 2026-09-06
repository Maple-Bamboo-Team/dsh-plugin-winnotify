// src/quote.ts
var FALLBACK_QUOTE = "\u4E0D\u8BF1\u4E8E\u8A89\uFF0C\u4E0D\u6050\u4E8E\u8BFD\u3002";
function greeting(hour, username) {
  const word = hour < 5 ? "\u591C\u6DF1\u4E86" : hour < 11 ? "\u65E9\u4E0A\u597D" : hour < 13 ? "\u4E2D\u5348\u597D" : hour < 18 ? "\u4E0B\u5348\u597D" : "\u665A\u4E0A\u597D";
  return `${word}\uFF0C${username}`;
}
function compact(text, limit) {
  const chars = Array.from(text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim());
  return chars.length > limit ? chars.slice(0, limit - 1).join("") + "\u2026" : chars.join("");
}
async function fetchQuote(url, timeoutMs, signal, request = fetch) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
  try {
    const response = await request(url, { signal: deadline, headers: { Accept: "application/json" } });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`HTTP ${response.status}`);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty Hitokoto response");
    let raw = "";
    let bytes = 0;
    const decoder = new TextDecoder();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16384) throw new Error("Hitokoto response too large");
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || !("hitokoto" in data) || typeof data.hitokoto !== "string" || !data.hitokoto.trim()) {
      throw new Error("Hitokoto returned no sentence");
    }
    return compact(data.hitokoto, 96);
  } catch {
    signal.throwIfAborted();
    return FALLBACK_QUOTE;
  }
}
export {
  FALLBACK_QUOTE,
  compact,
  fetchQuote,
  greeting
};
//# sourceMappingURL=quote.js.map
