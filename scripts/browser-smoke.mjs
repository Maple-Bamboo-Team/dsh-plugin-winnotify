import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const url = process.argv[2];
if (!url) throw new Error('Pass the isolated dsh test URL.');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  await context.route('**/plugins/**', async route => {
    if (!route.request().url().includes('dsh-plugin-winnotify')) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    const instrumented = body.replace('return module.exports;}});',
      'return {...module.exports,apply(ctx,config){window.__winnotifyTestContext=ctx;return module.exports.apply(ctx,config);}};}});');
    await route.fulfill({ response, body: instrumented });
  });
  const page = await context.newPage();
  const reports = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/winnotify/presence') reports.push(request.postDataJSON()?.payload);
  });
  await page.goto(url);
  const intro = page.getByRole('button', { name: '继续', exact: true });
  if (await intro.isVisible()) await intro.click();
  try {
    await page.waitForFunction(() => !!window.__winnotifyTestContext, null, { timeout: 15000 });
  } catch (error) {
    console.error(await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1400), modules: window.__DSH_BOOT__?.entries?.map(row => row.id), loader: Object.keys(window.__ModuleLoader__ ?? {}) })));
    console.error(errors);
    await page.screenshot({ path: '.test-output/browser-failure.png' });
    throw error;
  }
  await page.waitForFunction(() => window.__winnotifyTestContext.sessions.list.getSnapshot().phase === 'ready');
  const ids = await page.evaluate(async cwd => {
    const sessions = window.__winnotifyTestContext.sessions;
    return [await sessions.create({ cwd }), await sessions.create({ cwd })];
  }, process.cwd());
  await page.evaluate(id => window.__winnotifyTestContext.sessions.open(id), ids[0]);
  await page.bringToFront();
  await page.waitForTimeout(800);
  assert.ok(reports.some(report => report?.sessionId === ids[0] && report.focused), 'Selected foreground session reports focus');
  await page.evaluate(id => window.__winnotifyTestContext.sessions.open(id), ids[1]);
  await page.waitForTimeout(500);
  assert.ok(reports.some(report => report?.sessionId === ids[1] && report.focused), 'Switching session updates focus');
  // Headless Chromium reports every page focused. Exercise the DOM focus edge explicitly.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => false });
    window.dispatchEvent(new Event('blur'));
  });
  await page.waitForTimeout(500);
  assert.equal(reports.at(-1)?.focused, false, 'Background page releases focus');
  await page.evaluate(() => {
    delete document.hasFocus;
    window.dispatchEvent(new Event('focus'));
  });
  await page.bringToFront();
  await page.screenshot({ path: '.test-output/dsh-desktop.png' });
  const link = new URL(url);
  link.search = '';
  link.hash = `winnotify-session=${encodeURIComponent(ids[0])}`;
  const opened = await context.newPage();
  opened.on('pageerror', error => errors.push(error.message));
  await opened.goto(link.href);
  await opened.waitForFunction(id => window.__winnotifyTestContext?.sessions.list.getSnapshot().current === id, ids[0]);
  assert.equal(new URL(opened.url()).hash, '', 'Consumed link marker is removed');
  await opened.setViewportSize({ width: 390, height: 844 });
  await opened.screenshot({ path: '.test-output/dsh-mobile.png' });
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log('PASS: automatic client loading, focus changes, two sessions, notification link, desktop/mobile.');
} finally { await browser.close(); }
