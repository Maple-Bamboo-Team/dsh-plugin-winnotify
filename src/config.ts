import z from '@deepseek-ai/schemastery';

/** Deployment choices exposed in cordis.patch.yml. */
export interface Options {
  welcome: boolean;
  approval: boolean;
  question: boolean;
  error: boolean;
  completed: boolean;
  interrupted: boolean;
  sound: boolean;
  quoteUrl: string;
  quoteTimeoutMs: number;
  heartbeatMs: number;
  presenceTtlMs: number;
  notificationDelayMs: number;
  nativeTimeoutMs: number;
  maxBodyChars: number;
}

/** Schema defaults are also used by direct callers and the preview command. */
export const Config: z<Partial<Options>, Options> = z.object({
  welcome: z.boolean().default(true),
  approval: z.boolean().default(true),
  question: z.boolean().default(true),
  error: z.boolean().default(true),
  completed: z.boolean().default(true),
  interrupted: z.boolean().default(true),
  sound: z.boolean().default(true),
  quoteUrl: z.string().default('https://v1.hitokoto.cn/?encode=json&max_length=48'),
  quoteTimeoutMs: z.natural().min(1000).max(120000).default(15000),
  heartbeatMs: z.natural().min(500).max(10000).default(2000),
  presenceTtlMs: z.natural().min(1500).max(60000).default(8000),
  notificationDelayMs: z.natural().max(5000).default(300),
  nativeTimeoutMs: z.natural().min(1000).max(30000).default(8000),
  maxBodyChars: z.natural().min(40).max(500).default(160),
});

/** Validate coupled settings before registering any resources. */
export function resolveOptions(input: Partial<Options> = {}): Options {
  const options = Config(input);
  if (options.presenceTtlMs < 3 * options.heartbeatMs) {
    throw new Error('WinNotify: presenceTtlMs must be at least 3 * heartbeatMs');
  }
  if (new URL(options.quoteUrl).protocol !== 'https:') {
    throw new Error('WinNotify: quoteUrl must use HTTPS');
  }
  return options;
}
