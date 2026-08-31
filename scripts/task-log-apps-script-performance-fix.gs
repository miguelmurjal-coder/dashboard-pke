/**
 * Substituir apenas estas duas funções no Apps Script do MKT PKE 2026.
 * Limita a leitura do Log Tarefas às cinco colunas realmente usadas pelo MCP.
 */
function readTaskLogEntriesMerged_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(TASK_LOG_SHEET_NAME);
  if (!sheet) throw new Error('Folha "Log Tarefas" não encontrada.');

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
