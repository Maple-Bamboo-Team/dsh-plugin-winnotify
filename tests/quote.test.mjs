import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { compact, fetchQuote, FALLBACK_QUOTE, greeting } from '../lib/quote.js';
import { resolveOptions } from '../lib/config.js';

test('greetings follow all five local-time periods', () => {
  const samples = [[0, '夜深了'], [4, '夜深了'], [5, '早上好'], [10, '早上好'], [11, '中午好'], [12, '中午好'], [13, '下午好'], [17, '下午好'], [18, '晚上好'], [23, '晚上好']];
  for (const [hour, word] of samples) assert.equal(greeting(hour, '测试'), `${word}，测试`);
});

test('keeps a delayed sentence and excludes its author and source', async () => {
  const result = await fetchQuote('https://example.test', 1000, new AbortController().signal, async () => {
    await delay(70);
    return Response.json({ hitokoto: '迟一点也没关系。', from_who: '作者', from: '出处' });
  });
  assert.equal(result, '迟一点也没关系。');
});

test('network, HTTP, malformed and empty responses use the exact fallback', async () => {
  for (const request of [
    async () => { throw new Error('offline'); },
    async () => new Response('no', { status: 503 }),
    async () => new Response('not JSON'),
    async () => Response.json({ hitokoto: '  ' }),
    async () => Response.json({ from_who: 'writer' }),
    async () => new Response('x'.repeat(17000)),
  ]) assert.equal(await fetchQuote('https://example.test', 1000, new AbortController().signal, request), '不诱于誉，不恐于诽。');
});

test('timeout falls back but plugin disposal cancels instead of producing a toast', async () => {
  const request = async (_url, { signal }) => { await delay(100, null, { signal }); return Response.json({ hitokoto: 'late' }); };
  assert.equal(await fetchQuote('https://example.test', 25, new AbortController().signal, request), FALLBACK_QUOTE);
  const controller = new AbortController();
  const pending = fetchQuote('https://example.test', 1000, controller.signal, request);
  controller.abort(new Error('disposed'));
  await assert.rejects(pending, /disposed/);
});

test('text normalization keeps Unicode and schema validates related timing', () => {
  assert.equal(compact('a\n\t b', 20), 'a b');
  assert.equal(compact('测试文字', 3), '测试…');
  assert.equal(resolveOptions().quoteTimeoutMs, 15000);
  assert.equal(resolveOptions().question, true);
  assert.throws(() => resolveOptions({ heartbeatMs: 3000, presenceTtlMs: 8000 }), /at least/);
  assert.throws(() => resolveOptions({ quoteUrl: 'http://example.test' }), /HTTPS/);
});
