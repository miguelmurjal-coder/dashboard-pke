const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let stored = null;
let now = 100000;
let released = 0;
let locked = true;
const context = vm.createContext({
  Date: { now: () => now },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: () => stored,
    setProperty: (_key, value) => { stored = value; }
  }) },
  LockService: { getScriptLock: () => ({ tryLock: () => locked, releaseLock: () => released++ }) }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'MKT-PKE-2026-COMPLETO.gs'), 'utf8'), context);
const request = p => JSON.parse(JSON.stringify(context.sharedPanelAlert_(p)));
assert.deepEqual(request({ action: 'alertRead' }), { ok: true, sequence: 0, events: [] });
const first = request({ action: 'alertSend', id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
assert.equal(first.event.sequence, 1);
assert.equal(request({ action: 'alertRead' }).events.length, 0, 'New visitors must not replay earlier alerts');
assert.deepEqual(request({ action: 'alertRead', after: '0' }).events, [first.event], 'Another browser receives the shared event');
assert.deepEqual(request({ action: 'alertSend', id: first.event.id }), first, 'Retrying a request must not broadcast twice');
assert.equal(request({ action: 'alertRead', after: '1' }).events.length, 0);
assert.throws(() => request({ action: 'alertSend', id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }), /Espera/);
now += 4000;
assert.equal(request({ action: 'alertSend', id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' }).event.sequence, 2);
assert.equal(request({ action: 'alertRead', after: '0' }).events.length, 2);
now += 61000;
assert.equal(request({ action: 'alertRead', after: '0' }).events.length, 0, 'Expired alerts must not replay after a long disconnection');
assert.equal(request({ action: 'alertRead' }).sequence, 2, 'Sequence survives event expiry');
assert.throws(() => request({ action: 'alertSend', id: 'invalid' }), /inválido/);
const releasesBefore = released;
locked = false;
assert.equal(request({ action: 'alertRead' }).ok, true, 'Reads must succeed while a writer holds the lock');
assert.throws(() => request({ action: 'alertSend', id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }), /ocupado/);
assert.equal(released, releasesBefore);
// Exercise the actual endpoint routing and its existing token check without exposing the token.
vm.runInContext(`
  taskLogJsonp_ = (_callback, payload) => payload;
  if (doGet({parameter: {action: 'alertRead', token: 'invalid'}}).ok !== false) throw new Error('Token validation bypassed');
`, context);
locked = true;
assert.equal(vm.runInContext("doGet({parameter: {action: 'alertRead', token: TASK_LOG_TOKEN}}).sequence", context), 2);
console.log('Shared alert checks passed: delivery, initial baseline, deduplication, cooldown, expiry, locking and endpoint authentication');
