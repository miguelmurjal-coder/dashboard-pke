const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('  const panelRequestQueues = new Map();');
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
  const chatRead = context.sharedAlertRequest('chatRead');
  const secondRead = context.sharedAlertRequest('alertRead');
  const send = context.sharedAlertRequest('alertSend');
  const secondSend = context.sharedAlertRequest('chatSend');
  await flush();
  assert.equal(scripts.length, 3, 'Alert read, chat read and a user send start independently');
  assert.equal(new URL(scripts[2].src).searchParams.get('action'), 'alertSend', 'A send bypasses pending reads');
  context.window[callback(scripts[2])]({ ok: true });
  await send; await flush();
  assert.equal(scripts.length, 4);
  assert.equal(new URL(scripts[3].src).searchParams.get('action'), 'chatSend', 'Writes remain serialized');
  context.window[callback(scripts[3])]({ ok: true });
  await secondSend;
  context.window[callback(scripts[0])]({ ok: true, sequence: 0 });
  await first; await flush();
  assert.equal(scripts.length, 5, 'A second read in the same lane starts only after the first completes');
  assert.ok(scripts[0].removed);
  context.window[callback(scripts[1])]({ ok: true, online: 1 });
  context.window[callback(scripts[4])]({ ok: true, sequence: 0 });
  await Promise.all([chatRead, secondRead]);
  const timeout = context.sharedAlertRequest('alertRead').catch(e => e);
  const afterTimeout = context.sharedAlertRequest('alertRead');
  await flush();
  const expired = scripts[5];
  const timeoutEntry = [...timers.values()].find(t => t.delay === 25000);
  assert.ok(timeoutEntry, 'Allow 25 seconds for Apps Script cold starts and redirects');
  timeoutEntry.fn();
  assert.match((await timeout).message, /demorou/);
  assert.doesNotThrow(() => context.window[callback(expired)]({ ok: true }), 'Late JSONP callbacks must be harmless');
  await flush();
  assert.equal(scripts.length, 7, 'A failed request must not block its lane');
  context.window[callback(scripts[6])]({ ok: true });
  await afterTimeout;
  const rejected = context.sharedAlertRequest('chatRead').catch(e => e);
  await flush();
  context.window[callback(scripts[7])]({ ok: false, error: 'Ação inválida.' });
  assert.equal((await rejected).permanent, true);
  const state = { lastSuccess: 1000, failures: 0 };
  assert.equal(context.panelConnectionFailed(state, {}, 2000), false, 'One transient failure enters recovery, not offline');
  assert.equal(context.panelConnectionFailed(state, {}, 3000), false);
  assert.equal(context.panelConnectionFailed(state, {}, 4000), true, 'Three consecutive failures must mark offline');
  assert.equal(context.panelConnectionFailed({ lastSuccess: null, failures: 0 }, {}, 2000), true);
  assert.equal(context.panelConnectionFailed({ lastSuccess: 1000, failures: 0 }, {}, 91000), true, 'Stale connections cannot remain available');
  assert.equal(context.panelConnectionFailed({ lastSuccess: 1000, failures: 0 }, { permanent: true }, 2000), true, 'Explicit server errors must not be hidden');
  console.log('Connection checks passed: independent read/write lanes, immediate sends during pending reads, write serialization, timeout, late callbacks, queue recovery, transient failure tolerance, offline thresholds and explicit server errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
