const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('  let panelRequestQueue = Promise.resolve();');
const end = html.indexOf('  function useSharedAlert()', start);
const scripts = [];
const timers = new Map();
let timerId = 0;
const context = vm.createContext({
  window: {}, URLSearchParams,
  TASK_LOG_WRITE_ENDPOINT: 'https://example.test/exec', TASK_LOG_WRITE_TOKEN: 'test',
  document: {
    createElement: () => ({ remove() { this.removed = true; } }),
    head: { appendChild: script => scripts.push(script) }
  },
  setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; },
  clearTimeout: id => timers.delete(id)
});
vm.runInContext(html.slice(start, end), context);
const flush = async () => { for (let n = 0; n < 10; n++) await Promise.resolve(); };
const callback = script => new URL(script.src).searchParams.get('callback');
(async () => {
  const first = context.sharedAlertRequest('alertRead');
  const second = context.sharedAlertRequest('chatRead');
  await flush();
  assert.equal(scripts.length, 1, 'Chat and alert requests must not overlap');
  context.window[callback(scripts[0])]({ ok: true, sequence: 0 });
  await first; await flush();
  assert.equal(scripts.length, 2);
  assert.ok(scripts[0].removed);
  context.window[callback(scripts[1])]({ ok: true, online: 1 });
  await second;
  const timeout = context.sharedAlertRequest('alertRead').catch(e => e);
  const afterTimeout = context.sharedAlertRequest('chatRead');
  await flush();
  const expired = scripts[2];
  const timeoutEntry = [...timers.values()].find(t => t.delay === 25000);
  assert.ok(timeoutEntry, 'Allow 25 seconds for Apps Script cold starts and redirects');
  timeoutEntry.fn();
  assert.match((await timeout).message, /demorou/);
  assert.doesNotThrow(() => context.window[callback(expired)]({ ok: true }), 'Late JSONP callbacks must be harmless');
  await flush();
  assert.equal(scripts.length, 4, 'A failed request must not block the queue');
  context.window[callback(scripts[3])]({ ok: true });
  await afterTimeout;
  const rejected = context.sharedAlertRequest('chatRead').catch(e => e);
  await flush();
  context.window[callback(scripts[4])]({ ok: false, error: 'Ação inválida.' });
  assert.equal((await rejected).permanent, true);
  const state = { lastSuccess: 1000, failures: 0 };
  assert.equal(context.panelConnectionFailed(state, {}, 2000), false, 'One transient failure enters recovery, not offline');
  assert.equal(context.panelConnectionFailed(state, {}, 3000), false);
  assert.equal(context.panelConnectionFailed(state, {}, 4000), true, 'Three consecutive failures must mark offline');
  assert.equal(context.panelConnectionFailed({ lastSuccess: null, failures: 0 }, {}, 2000), true);
  assert.equal(context.panelConnectionFailed({ lastSuccess: 1000, failures: 0 }, {}, 91000), true, 'Stale connections cannot remain available');
  assert.equal(context.panelConnectionFailed({ lastSuccess: 1000, failures: 0 }, { permanent: true }, 2000), true, 'Explicit server errors must not be hidden');
  console.log('Connection checks passed: serialization, timeout, late callbacks, queue recovery, transient failure tolerance, offline thresholds and explicit server errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
