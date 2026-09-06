import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { load } from 'js-yaml';
import { Context, Service } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import SessionStore from '@deepseek-ai/dsh-session';

test('Loader composition observes real Session events, focus, approval and unload', async t => {
  if (process.platform !== 'win32') return t.skip('Windows host plugin');
  await mkdir('.test-output', { recursive: true });
  await build({
    entryPoints: ['src/index.ts'], outfile: '.test-output/host.js', bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: [{ name: 'native-test-boundary', setup(build) {
      build.onResolve({ filter: /^\.\/native\.ts$/ }, () => ({ path: resolve('tests/fixtures/native.mjs') }));
    } }],
  });
  globalThis.__winnotifyTest = { notices: [] };
  const notices = globalThis.__winnotifyTest.notices;
  const routes = new Map();
  class Connection extends Service {
    constructor(ctx) { super(ctx, 'connection'); }
    get rpc() {
      const owner = this.ctx;
      return { handle(channel, handler) { return owner.effect(() => { routes.set(channel, handler); return () => routes.delete(channel); }); } };
    }
    authenticatedUrl(url) { return url; }
  }
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); delete globalThis.__winnotifyTest; });
  await ctx.plugin(SessionStore);
  await ctx.plugin(Connection);
  ctx.provide('agents', {});
  ctx.provide('webServer', { port: 34567 });
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(resolve('.test-output') + '/').href });
  await ctx.loader.root.update(load(await readFile('tests/fixtures/cordis.yml', 'utf8')));
  await ctx.loader.await();
  const session = ctx.sessions.create('notify-session', { meta: { cwd: process.cwd() } });
  const agent = { id: session.id, session };
  const presence = (sequence, focused, sessionId = session.id) => routes.get('/winnotify')('presence', { clientId: 'test-browser-123456789', sequence, sessionId, focused });
  const end = (turn, reason) => {
    session.append('turn/start', { turn });
    session.append('step/start', { turn, step: 1 });
    session.append('step/end', { turn, step: 1 });
    session.append('turn/end', { turn, reason });
  };
  await presence(1, true);
  end(1, { kind: 'completed' });
  await delay(30);
  assert.equal(notices.length, 0);
  await presence(2, true, 'different-session');
  end(2, { kind: 'completed' });
  await delay(30);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, 'main');
  assert.equal(notices[0].body, '任务已完成');
  assert.match(notices[0].url, /#winnotify-session=notify-session$/);
  ctx.emit('agent/error', { agent, turn: 3, step: 1, error: new Error('Error: boom') });
  end(3, { kind: 'error', error: { code: 'UNKNOWN', message: 'Error: boom' } });
  await delay(30);
  assert.equal(notices.length, 2);
  assert.equal(notices.at(-1).body, '未经处理的异常：Error: boom');
  end(4, { kind: 'aborted', reason: { kind: 'disposed' } });
  await delay(30);
  assert.equal(notices.length, 2);
  end(5, { kind: 'aborted', reason: { kind: 'user' } });
  await delay(30);
  assert.equal(notices.at(-1).title, 'main');
  assert.equal(notices.at(-1).body, '任务中断：执行已取消');
  await presence(3, true);
  let answer;
  const pending = ctx.waterfall('approval/request', { agent, toolName: 'bash', reason: '状态探测：如果现在是早上开工前，你通常会？' }, () => new Promise(resolve => { answer = resolve; }));
  await delay(30);
  const count = notices.length;
  await presence(4, false);
  await delay(30);
  assert.equal(notices.length, count + 1);
  assert.equal(notices.at(-1).title, 'main');
  assert.equal(notices.at(-1).body, '等待回答：状态探测——如果现在是早上开工前，你通常会？');
  await presence(5, false);
  await delay(30);
  assert.equal(notices.length, count + 1);
  answer('allowed-once');
  assert.equal(await pending, 'allowed-once');
  const fast = ctx.waterfall('approval/request', { agent, toolName: 'bash' }, async () => 'rejected');
  await fast;
  await delay(30);
  assert.equal(notices.length, count + 1);
  await presence(6, true);
  let answerQuestion;
  const question = ctx.waterfall('user-questions/request', {
    agent,
    questions: [{ id: 'checkpoint', header: 'Checkpoint', question: 'Ready to continue?' }],
  }, () => new Promise(resolve => { answerQuestion = resolve; }));
  await delay(30);
  const questionCount = notices.length;
  await presence(7, false);
  await delay(30);
  assert.equal(notices.length, questionCount + 1);
  assert.equal(notices.at(-1).title, 'main');
  assert.equal(notices.at(-1).body, '等待回答：Checkpoint——Ready to continue?');
  answerQuestion({ answers: [] });
  assert.deepEqual(await question, { answers: [] });
  end(6, { kind: 'completed' });
  await ctx.loader.remove('winnotify-test');
  await delay(30);
  assert.equal(routes.has('/winnotify'), false);
  assert.equal(notices.length, count + 2);
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ hitokoto: '唯一的启动一言', from_who: '不会显示的作者' });
  try {
    const rows = load(await readFile('tests/fixtures/cordis.yml', 'utf8'));
    rows[0].config.welcome = true;
    await ctx.loader.root.update(rows);
    await ctx.loader.await();
    await delay(30);
    assert.equal(notices.at(-1).body, '唯一的启动一言');
    assert.notEqual(notices.at(-1).title, 'DeepSeek Harness');
    const afterWelcome = notices.length;
    await ctx.loader.remove('winnotify-test');
    await ctx.loader.root.update(rows);
    await ctx.loader.await();
    await delay(30);
    assert.equal(notices.length, afterWelcome, 'Hot reload does not repeat the welcome');
  } finally { globalThis.fetch = fetchBefore; }
});
