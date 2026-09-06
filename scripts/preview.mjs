import { userInfo } from 'node:os';
import { NativeToast } from '../lib/native.js';
import { fetchQuote, FALLBACK_QUOTE, greeting } from '../lib/quote.js';
const controller = new AbortController();
const quote = process.argv.includes('--fallback') ? FALLBACK_QUOTE
  : await fetchQuote('https://v1.hitokoto.cn/?encode=json&max_length=48', 15000, controller.signal);
await new NativeToast(controller.signal, 8000, true).show({
  title: greeting(new Date().getHours(), userInfo().username), body: quote, tag: 'preview',
});
console.log('WinNotify preview sent.');
