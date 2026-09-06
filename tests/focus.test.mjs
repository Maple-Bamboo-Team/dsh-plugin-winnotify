import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { FocusTracker, DeliveryQueue, parsePresence } from '../lib/policy.js';
import { startFocusReporting } from '../lib/browser.js';

test('multiple tabs, stale reports and expired focus are handled independently', () => {
  let now = 100;
  const focus = new FocusTracker(8000, () => now);
  const page = { clientId: 'page-a-1234567890', sequence: 1, sessionId: 'session-a', focused: true };
  focus.update(page);
  assert.equal(focus.focused(['session-a']), true);
  assert.equal(focus.focused(['session-b']), false);
  focus.update({ ...page, sequence: 3, focused: false });
  focus.update({ ...page, sequence: 2, focused: true });
  assert.equal(focus.focused(['session-a']), false);
  focus.update({ ...page, clientId: 'page-b-1234567890' });
  assert.equal(focus.focused(['session-a']), true);
  now += 8001;
  assert.equal(focus.focused(['session-a']), false);
  assert.throws(() => parsePresence({ ...page, sequence: -1 }), /Invalid/);
  assert.throws(() => parsePresence({ ...page, focused: 'yes' }), /Invalid/);
});

test('focus reporter sends changes, releases on disposal and removes its subscriber', async () => {
  let listener;
  let selected = 'a';
  let focused = true;
  const reports = [];
  const reporter = startFocusReporting({
    clientId: 'browser-1234567890', current: () => selected, focused: () => focused,
    subscribe(callback) { listener = callback; return () => { listener = undefined; }; },
    async send(report) { reports.push(report); return 2000; },
  });
  focused = false; listener();
  selected = 'b'; focused = true; listener();
  await reporter.dispose();
  assert.equal(listener, undefined);
  assert.deepEqual(reports.map(r => [r.sessionId, r.focused]), [['a', true], ['a', false], ['b', true], [null, false]]);
  assert.ok(reports.every((r, i) => i === 0 || r.sequence > reports[i - 1].sequence));
});

test('disposal cancels pending notifications and awaits in-flight work', async () => {
  const queue = new DeliveryQueue();
  let sent = false;
  const pending = queue.schedule(50, async () => { sent = true; return true; });
  await queue.close();
  assert.equal(await pending, false);
  assert.equal(sent, false);
  const active = new DeliveryQueue();
  active.schedule(0, async () => { await delay(30); sent = true; return true; });
  await delay(5);
  await active.close();
  assert.equal(sent, true);
});
