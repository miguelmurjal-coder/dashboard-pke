const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let now = 100000;
let releases = 0;
let canLock = true;
const values = { PKE_PANEL_ALERT: 'existing-alert-state', unrelated: 'preserve' };
const context = vm.createContext({
  Date: { now: () => now },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: key => values[key] || null,
    getProperties: () => ({ ...values }),
    setProperty: (key, value) => { values[key] = value; },
    deleteProperty: key => { delete values[key]; }
  }) },
  LockService: { getScriptLock: () => ({ tryLock: () => canLock, releaseLock: () => releases++ }) },
  Utilities: { newBlob: text => ({ getBytes: () => Buffer.from(text, 'utf8') }) }
});
for (const file of ['MKT-PKE-2026-COMPLETO.gs', 'panel-chat-apps-script-extension.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
}
const id = suffix => `00000000-0000-0000-0000-${String(suffix).padStart(12, '0')}`;
const a = { visitor: id(1), client: id(2) };
const b = { visitor: id(3), client: id(4) };
const request = p => JSON.parse(JSON.stringify(context.sharedPanelChat_(p)));
assert.equal(request({ action: 'chatRead', ...a }).online, 1);
assert.equal(request({ action: 'chatRead', ...a, client: id(5) }).online, 1, 'Multiple tabs in one browser count once');
assert.equal(request({ action: 'chatRead', ...b }).online, 2, 'Independent browsers count separately');
const message = { action: 'chatSend', ...a, id: id(10), name: 'Miguel', text: '<img src=x onerror=alert(1)> Olá 👋' };
const sent = request(message);
assert.equal(sent.messages.length, 1);
assert.equal(sent.messages[0].text, message.text);
assert.equal(sent.revision, 1);
assert.ok(!('visitor' in sent.messages[0]), 'Internal visitor identifiers must not be exposed');
assert.equal(request(message).messages.length, 1, 'Retry is idempotent');
assert.equal(request({ action: 'chatRead', ...b }).messages[0].id, message.id, 'Another browser receives the message');
assert.throws(() => request({ ...message, id: id(11) }), /2 segundos/);
assert.throws(() => request({ ...message, id: id(12), text: '' }), /Preenche/);
assert.throws(() => request({ ...message, id: id(12), text: 'a'.repeat(281) }), /Preenche/);
assert.throws(() => request({ ...message, id: id(12), name: 'a'.repeat(25) }), /Preenche/);
assert.throws(() => request({ action: 'chatRead', visitor: 'invalid', client: id(2) }), /Sessão/);
now += 91000;
assert.equal(request({ action: 'chatRead', ...a }).online, 1, 'Inactive browsers expire');
assert.ok(!values[`PKE_PANEL_VISIT_${b.client}`]);
for (let n = 20; n < 60; n++) {
  now += 2100;
  request({ ...message, id: id(n), text: '👋'.repeat(140) });
  assert.ok(Buffer.byteLength(values.PKE_PANEL_CHAT, 'utf8') <= 8000, 'Respect Script Property byte limits with Unicode');
}
assert.ok(JSON.parse(values.PKE_PANEL_CHAT).messages.length <= 30);
now += 24 * 60 * 60 * 1000 + 1;
assert.equal(request({ action: 'chatRead', ...b }).messages.length, 0, 'History expires after 24 hours');
assert.equal(values.PKE_PANEL_ALERT, 'existing-alert-state');
assert.equal(values.unrelated, 'preserve');
const releaseCount = releases;
canLock = false;
assert.throws(() => request({ action: 'chatRead', ...b }), /ocupado/);
assert.equal(releases, releaseCount);
canLock = true;
vm.runInContext('taskLogJsonp_ = (_callback, payload) => payload;', context);
context.testIdentity = a;
assert.equal(vm.runInContext("doGet({parameter:{action:'chatRead',token:TASK_LOG_TOKEN,...testIdentity}}).ok", context), true);
assert.equal(vm.runInContext("doGet({parameter:{action:'chatRead',token:'invalid',...testIdentity}}).ok", context), false);
console.log('Chat checks passed: shared history, browser/tab counting, presence expiry, retry deduplication, validation, cooldown, Unicode storage limits, history expiry, locking, routing and preservation of existing data');
