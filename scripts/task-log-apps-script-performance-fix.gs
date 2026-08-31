/**
 * Correção de performance e concorrência para a API do Log Tarefas.
 *
 * 1. Adicionar TASK_LOG_SPREADSHEET_ID e getTaskLogSheet_.
 * 2. Substituir doGet, readTaskLogEntriesMerged_, buildTaskLogMergeMap_,
 *    appendTaskLogEntry_, updateTaskLogEntry_ e findTaskTargetRow_.
 * 3. Criar uma nova versão da implementação Web App.
 */
const TASK_LOG_SPREADSHEET_ID = '1NdCeyxLExmZtGmdQ6m63Iv2XCzzWiUnadWj4UOwmJjM';

function getTaskLogSheet_() {
  const spreadsheet = SpreadsheetApp.openById(TASK_LOG_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(TASK_LOG_SHEET_NAME);
  if (!sheet) throw new Error('Folha "Log Tarefas" não encontrada.');
  return sheet;
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  const callback = String(p.callback || 'callback').replace(/[^\w.$]/g, '');

  try {
    if (p.token !== TASK_LOG_TOKEN) {
      return taskLogJsonp_(callback, { ok: false, error: 'Token inválido.' });
    }

    if (p.action === 'read') {
      return taskLogJsonp_(callback, { ok: true, entries: readTaskLogEntriesMerged_() });
    }

    if (p.action !== 'append' && p.action !== 'update') {
      return taskLogJsonp_(callback, { ok: false, error: 'Ação inválida.' });
    }

    const entry = {
      date: p.date || '',
      hour: p.hour || '',
      task: p.task || '',
      category: p.category || '',
      status: p.status || '',
      notes: p.notes || ''
    };
    if (!entry.task) return taskLogJsonp_(callback, { ok: false, error: 'Tarefa vazia.' });

    const oldEntry = {
      date: p.oldDate || '',
      hour: p.oldHour || '',
      task: p.oldTask || '',
      category: p.oldCategory || '',
      status: p.oldStatus || '',
      notes: p.oldNotes || ''
    };

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('Log Tarefas ocupado por outra gravação. Tenta novamente.');
    try {
      const result = p.action === 'update'
        ? updateTaskLogEntry_(entry, oldEntry)
        : appendTaskLogEntry_(entry);
      SpreadsheetApp.flush();
      return taskLogJsonp_(callback, { ok: true, row: result.row, mode: result.mode });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return taskLogJsonp_(callback, {
      ok: false,
      error: err && err.message ? err.message : String(err)
    });
  }
}

function readTaskLogEntriesMerged_() {
  const sheet = getTaskLogSheet_();

  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];

  const range = sheet.getRange(1, 1, lastRow, 5);
  const values = range.getDisplayValues();
  const mergeMap = buildTaskLogMergeMap_(range, values);

  const entries = [];
  const seen = {};
  let currentYear = new Date().getFullYear();
  let currentDate = null;

  for (let r = 0; r < values.length; r++) {
    const cells = [0, 1, 2, 3, 4].map(c => taskLogEffectiveCell_(values, mergeMap, r, c));
    const joined = cells.filter(Boolean).join(' ');
    const normalized = taskLogNormalize_(joined);
    const yearMatch = joined.match(/\b(20\d{2})\b/);
    if (yearMatch) currentYear = Number(yearMatch[1]);

    const parsedDay = taskLogParsePtDayDate_(joined, currentYear);
    if (parsedDay) {
      currentDate = parsedDay;
      continue;
    }

    if (!currentDate) continue;
    if (taskLogNormalize_(cells[0]) === 'hora' || taskLogNormalize_(cells[1]) === 'tarefa') continue;
    if (normalized.includes('almoco')) continue;

    const task = String(cells[1] || '').trim();
    const minute = taskLogTimeToMinutes_(cells[0]);
    if (!task || minute === null) continue;

    const taskMerge = taskLogMergeForCell_(mergeMap, r, 1);
    const uniqueKey = [taskLogDateKey_(currentDate), taskMerge ? taskMerge.topRow : r, taskMerge ? taskMerge.topCol : 1, task].join('|');
    if (seen[uniqueKey]) continue;
    seen[uniqueKey] = true;

    const endMinute = taskMerge ? taskLogMergedEndMinute_(values, taskMerge, minute) : minute + 15;
    entries.push({
      id: 'sheet-r' + (r + 1),
      source: 'sheet',
      row: r + 1,
      date: taskLogDateKey_(currentDate),
      hour: taskLogMinutesToTime_(minute) + '-' + taskLogMinutesToTime_(Math.max(minute + 15, endMinute)),
      task: task,
      category: String(cells[2] || 'Outro').trim() || 'Outro',
      status: String(cells[3] || '—').trim() || '—',
      notes: String(cells[4] || '').trim(),
      createdAt: ''
    });
  }

  return entries.reverse();
}

function buildTaskLogMergeMap_(dataRange, values) {
  const map = {};
  const baseRow = dataRange.getRow();
  const baseCol = dataRange.getColumn();

  dataRange.getMergedRanges().forEach(rg => {
    const topRow = rg.getRow() - baseRow;
    const topCol = rg.getColumn() - baseCol;
    const numRows = rg.getNumRows();
    const numCols = rg.getNumColumns();
    if (topRow < 0 || topCol < 0 || topCol >= 5) return;

    const value = values[topRow] && values[topRow][topCol] ? String(values[topRow][topCol]).trim() : '';
    const info = { topRow, topCol, numRows, numCols, value };
    const lastCol = Math.min(topCol + numCols, 5);

    for (let rr = topRow; rr < topRow + numRows; rr++) {
      for (let cc = topCol; cc < lastCol; cc++) map[rr + ':' + cc] = info;
    }
  });

  return map;
}

function appendTaskLogEntry_(entry) {
  const sheet = getTaskLogSheet_();
  const target = findTaskTargetRow_(sheet, entry.date, entry.hour);
  const row = target || Math.max(sheet.getLastRow() + 1, 2);
  writeTaskRowMerged_(sheet, row, entry, null);
  return { row, mode: target ? 'matched-slot-merged' : 'append-bottom' };
}

function updateTaskLogEntry_(entry, oldEntry) {
  const sheet = getTaskLogSheet_();
  const existingRow = findExistingTaskRow_(sheet, oldEntry) || findExistingTaskRow_(sheet, entry);
  const row = existingRow || findTaskTargetRow_(sheet, entry.date, entry.hour) || Math.max(sheet.getLastRow() + 1, 2);
  writeTaskRowMerged_(sheet, row, entry, oldEntry);
  return { row, mode: existingRow ? 'updated-existing-merged' : 'update-fallback-merged' };
}

function findTaskTargetRow_(sheet, isoDate, hourRange) {
  const date = taskLogParseIsoDate_(isoDate);
  if (!date) return null;

  const targetDayText = taskLogNormalize_(date.getDate() + ' de ' + taskLogMonthNamePt_(date.getMonth()));
  const hour = taskLogStartHour_(hourRange);
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return null;

  const values = sheet.getRange(1, 1, lastRow, 5).getDisplayValues();
  let inDay = false;

  for (let r = 0; r < values.length; r++) {
    const joined = taskLogNormalize_(values[r].join(' '));
    const isDayHeader = /\b\d{1,2}\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(joined);
    if (isDayHeader) {
      inDay = joined.indexOf(targetDayText) !== -1;
      continue;
    }
    if (!inDay) continue;

    const rowHour = String(values[r][0] || '').trim();
    const rowTask = String(values[r][1] || '').trim();
    if (rowHour === hour && !rowTask) return r + 1;
    if (rowHour === hour && rowTask) {
      for (let scan = r + 1; scan < Math.min(r + 6, values.length); scan++) {
        const scanTask = String(values[scan][1] || '').trim();
        const scanJoined = taskLogNormalize_(values[scan].join(' '));
        if (/\b\d{1,2}\s+de\s+/.test(scanJoined)) break;
        if (!scanTask) return scan + 1;
      }
    }
  }
  return null;
}
