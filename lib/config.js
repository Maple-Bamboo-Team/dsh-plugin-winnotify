// src/config.ts
import z from "@deepseek-ai/schemastery";
var Config = z.object({
  welcome: z.boolean().default(true),
  approval: z.boolean().default(true),
  question: z.boolean().default(true),
  error: z.boolean().default(true),
  completed: z.boolean().default(true),
  interrupted: z.boolean().default(true),
  sound: z.boolean().default(true),
  quoteUrl: z.string().default("https://v1.hitokoto.cn/?encode=json&max_length=48"),
  quoteTimeoutMs: z.natural().min(1e3).max(12e4).default(15e3),
  heartbeatMs: z.natural().min(500).max(1e4).default(2e3),
  presenceTtlMs: z.natural().min(1500).max(6e4).default(8e3),
  notificationDelayMs: z.natural().max(5e3).default(300),
  nativeTimeoutMs: z.natural().min(1e3).max(3e4).default(8e3),
  maxBodyChars: z.natural().min(40).max(500).default(160)
});
function resolveOptions(input = {}) {
  const options = Config(input);
  if (options.presenceTtlMs < 3 * options.heartbeatMs) {
    throw new Error("WinNotify: presenceTtlMs must be at least 3 * heartbeatMs");
  }
  if (new URL(options.quoteUrl).protocol !== "https:") {
    throw new Error("WinNotify: quoteUrl must use HTTPS");
  }
  return options;
}
export {
  Config,
  resolveOptions
};
//# sourceMappingURL=config.js.map
