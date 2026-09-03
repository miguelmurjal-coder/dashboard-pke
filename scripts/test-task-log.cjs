const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'MKT-PKE-2026-COMPLETO.gs'), 'utf8'), context);
assert.deepEqual(Array.from(context.taskLogQuarterStarts_('14:04-14:20')), [840, 855]);
assert.deepEqual(Array.from(context.taskLogQuarterStarts_('14:00-14:15')), [840]);
assert.deepEqual(Array.from(context.taskLogQuarterStarts_('bad')), []);
let writes = [];
const merge = {
  getColumn: () => 2, getNumColumns: () => 1, getNumRows: () => 4,
  getFormula: () => '', getValue: () => 'Existing task',
  breakApart: () => writes.push('unmerge'), setValues: rows => writes.push(rows)
};
context.breakApartIntersectingMerges_({getMergedRanges: () => [merge]});
assert.equal(writes[0], 'unmerge');
assert.equal(writes[1].length, 4);
assert.ok(writes[1].every(row => row[0] === 'Existing task'));
writes = [];
assert.throws(() => context.breakApartIntersectingMerges_({getMergedRanges: () => [merge, {...merge, getNumColumns: () => 5, getA1Notation: () => 'A1:E1'}]}));
assert.equal(writes.length, 0, 'Validate every merge before mutating any');
const values = [['Quarta - 12 de Setembro'], ['14:00'], ['Quarta - 2 de Setembro'], ['14:00']];
assert.equal(context.findTaskTargetRow_({getLastRow: () => values.length, getRange: () => ({getDisplayValues: () => values})}, '2026-09-02', '14:00'), 4);
const synced = [];
context.getTaskLogDbSheet_ = () => ({
  getLastRow: () => 3,
  getRange: () => ({getDisplayValues: () => [
    ['a', '2026-09-02', '14:00-14:30', 'Task A', 'Outro', 'Done'],
    ['b', '2026-09-02', '14:15-14:30', 'Task B', 'Outro', 'Done']
  ]})
});
context.getTaskLogSheet_ = () => ({});
context.findTaskTargetRow_ = () => 1129;
context.writeTaskRowMerged_ = (_sheet, _row, entry) => synced.push(entry);
context.SpreadsheetApp = {flush() {}};
context.syncTaskLogVisualForEntries_([{date:'2026-09-02', hour:'14:00-14:30'}]);
assert.equal(synced.length, 2);
assert.equal(synced[0].task, 'Task A');
assert.equal(synced[1].task, 'Task A\nTask B');
console.log('Task log regression checks passed');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
new vm.Script(html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>')));
const importContext = vm.createContext({
  taskOwner: 'Miguel', TASK_LOG_PUBLISHED_IDS_KEY: 'published',
  taskEntries: [{id: 'edited', task: 'Edited task'}],
  localStorage: {getItem: () => '["published"]'},
  parseTaskDraftFile: () => [{id:'new', date:'2026-09-03'}, {id:'edited', date:'2026-09-02'}, {id:'published', date:'2026-09-02'}],
  setTaskEntries: update => { importContext.taskEntries = update(importContext.taskEntries); },
  setTaskSyncMessage: message => { importContext.message = message; },
  FileReader: class {
    readAsText() { this.result = '{"generatedAt":"2026-09-02T14:10:07"}'; this.onload(); }
  }
});
const importCode = html.slice(html.indexOf('    const importTaskDrafts ='), html.indexOf('    const publishTaskDrafts ='));
vm.runInContext(importCode + '\nimportTaskDrafts({target:{files:[{}]}});', importContext);
assert.equal(importContext.taskEntries.length, 2);
assert.equal(importContext.taskEntries[1].task, 'Edited task');
assert.match(importContext.message, /1 novos blocos/);
assert.match(importContext.message, /1 já tinham sido publicados/);
vm.runInContext('importTaskDrafts({target:{files:[{}]}});', importContext);
assert.equal(importContext.taskEntries.length, 2);
assert.match(importContext.message, /0 novos blocos/);
console.log('Import duplicate and edit-preservation checks passed; dashboard syntax valid');
