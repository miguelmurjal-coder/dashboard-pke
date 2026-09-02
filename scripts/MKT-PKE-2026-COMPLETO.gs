/**
 * FUNÇÃO PARA O BOTÃO: 
 * Sincroniza apenas os últimos 7 dias (Leads -> Ficheiro JM) e atualiza o Dashboard.
 */
function atualizarValoresDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dashSheet = ss.getSheetByName("Dashboard MKT");
  const jmSheet = ss.getSheetByName("Ficheiro JM");
  const leadsSheet = ss.getSheetByName("Leads Diários");
  
  if (!dashSheet || !jmSheet || !leadsSheet) {
    SpreadsheetApp.getUi().alert("Erro: Abas não encontradas.");
    return;
  }

  try {
    // --- 1. SINCRONIZAÇÃO OTIMIZADA (Últimos 7 dias) ---
    const hoje = new Date();
    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(hoje.getDate() - 7);

    const dadosOrigem = leadsSheet.getRange("B2:K" + leadsSheet.getLastRow()).getValues();
    const rangeDatasDestino = jmSheet.getRange("A1:A" + jmSheet.getLastRow()).getValues();
    
    let sincronizados = 0;

    for (let i = 0; i < dadosOrigem.length; i++) {
      let dataO = dadosOrigem[i][0];
      
      // Só processa se for uma data e estiver dentro da última semana
      if (!(dataO instanceof Date) || dataO < seteDiasAtras) continue;

      for (let j = 0; j < rangeDatasDestino.length; j++) {
        let dataD = rangeDatasDestino[j][0];
        
        // Compara Dia, Mês e Ano (ignora linhas de texto como "MARÇO")
        if (dataD instanceof Date && 
            dataO.getFullYear() === dataD.getFullYear() &&
            dataO.getMonth() === dataD.getMonth() &&
            dataO.getDate() === dataD.getDate()) {
          
          let rowJM = j + 1; 

          // VALORES MONETÁRIOS (€)
          jmSheet.getRange(rowJM, 29).setValue(dadosOrigem[i][4]); // PS -> AC
          jmSheet.getRange(rowJM, 30).setValue(dadosOrigem[i][3]); // FO -> AD
          jmSheet.getRange(rowJM, 31).setValue(dadosOrigem[i][2]); // ADB -> AE
          
          // QUANTIDADES (#) - Mapeamento Screenshot (I=ADB, J=FO, K=PS)
          jmSheet.getRange(rowJM, 33).setValue(dadosOrigem[i][9]); // PS -> AG
          jmSheet.getRange(rowJM, 34).setValue(dadosOrigem[i][8]); // FO -> AH
          jmSheet.getRange(rowJM, 35).setValue(dadosOrigem[i][7]); // ADB -> AI
          
          sincronizados++;
          break;
        }
      }
    }

    // --- 2. CÁLCULOS DO DASHBOARD (Lógica Original) ---
    const dataJM = jmSheet.getRange("D3:S3").getValues()[0];
    const getValVMT = (s1Idx, s2Idx, divIdx) => {
      const v1 = Number(dataJM[s1Idx]) || 0;
      const v2 = Number(dataJM[s2Idx]) || 0;
      const div = Number(dataJM[divIdx]) || 0;
      return div !== 0 ? (v1 + v2) / div : 0;
    };

    const resU26 = getValVMT(0, 1, 13);
    const resU27 = getValVMT(3, 4, 14);
    const resU28 = getValVMT(6, 7, 15);

    const dataB = dashSheet.getRange("B56:B113").getValues();
    const valB = (row) => Number(dataB[row - 56][0]) || 0;

    const resW26 = valB(84) / (valB(56) || 1);
    const resW27 = valB(85) / (valB(57) || 1);
    const resW28 = valB(86) / (valB(58) || 1);

    const resY26 = 1 - (valB(111) / (valB(84) || 1));
    const resY27 = 1 - (valB(112) / (valB(85) || 1));
    const resY28 = 1 - (valB(113) / (valB(86) || 1));

    dashSheet.getRange("U26:U28").setValues([[resU26], [resU27], [resU28]]).setNumberFormat("#,##0 \"€\""); 
    dashSheet.getRange("W26:W28").setValues([[resW26], [resW27], [resW28]]).setNumberFormat("0.00%");
    dashSheet.getRange("Y26:Y28").setValues([[resY26], [resY27], [resY28]]).setNumberFormat("0.00%");

    ss.toast("Sincronização dos últimos 7 dias concluída!", "Sucesso");

  } catch (e) {
    SpreadsheetApp.getUi().alert("Erro: " + e.toString());
  }
}

/**
 * FUNÇÕES AUXILIARES MANTIDAS
 */
function onEdit(e) {
  if (!e) return;
  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== "Dashboard MKT") return;
  var timestamp = Utilities.formatDate(new Date(), "GMT+0", "dd/MM/yyyy HH:mm:ss");
  sheet.getRange("A1").setValue("Última edição: " + timestamp);
  updateDashboardHeaderWhenTableChanges();
}

function updateDashboardHeaderWhenTableChanges() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("Dashboard MKT");
  if (!sh) return;
  const header = sh.getRange("T15");
  const values = sh.getRange("T17:Y19").getDisplayValues();
  const flat = values.map(r => r.join("\u0001")).join("\u0002");
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, flat));
  const props = PropertiesService.getDocumentProperties();
  if (hash !== (props.getProperty("dash_table_hash") || "")) {
    header.setValue("Dados para Dashboard Diário / Atualizado em " + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), "dd/MM/yyyy HH:mm"));
    props.setProperty("dash_table_hash", hash);
  }
}

/* =========================================================
   NOVO — Snapshot semanal: Dashboard MKT -> Ficheiro JM
   (Histórico Valores Semanais)
   ========================================================= */

/**
 * Corre por trigger (Sábado) e faz append de 1 linha LOGO ABAIXO
 * do último registo preenchido da tabela do histórico (coluna AS = Data/Hora).
 */
function snapshotSemanal_DashboardParaJM() {
  snapshotSemanal_DashboardParaJM_IMPL_(false);
}

/** Forçar manual (para testes): grava sempre e marca Week ... (FORCE) */
function snapshotSemanal_DashboardParaJM_FORCE() {
  snapshotSemanal_DashboardParaJM_IMPL_(true);
}

function snapshotSemanal_DashboardParaJM_IMPL_(force) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dash = ss.getSheetByName("Dashboard MKT");
  const jm = ss.getSheetByName("Ficheiro JM");
  if (!dash) throw new Error('Sheet "Dashboard MKT" não encontrada.');
  if (!jm) throw new Error('Sheet "Ficheiro JM" não encontrada.');

  // ====== ORIGEM (Dashboard MKT) — conforme o teu layout ======
  // VMT real é U26:U28 (confirmado no teu log)
  const DASH_RNG_VMT = "U26:U28";

  // Conversão e Perda: como podem estar em colunas mais à direita, 
  // lemos "display" num bloco largo e apanhamos o 1º número em cada linha.
  // (Isto torna o script robusto mesmo que mexas 1-2 colunas no layout.)
  const DASH_RNG_CONV_WIDE  = "V26:AD28"; // procura aqui a 1ª percentagem em cada linha
  const DASH_RNG_PERDA_WIDE = "V26:AD28"; // procura aqui a 2ª percentagem em cada linha (Perda)

  const vmtDisp = dash.getRange(DASH_RNG_VMT).getDisplayValues();
  const convPerdaDisp = dash.getRange(DASH_RNG_CONV_WIDE).getDisplayValues(); // mesmo bloco para simplificar
  // ===========================================================

  const vmt = vmtDisp.flat().map(s => parsePTNumber_(s, false) || 0);

  // Em cada linha (PS/FO/ADB), apanha:
  // - 1ª percentagem -> CONV
  // - 2ª percentagem -> PERDA
  const conv = [];
  const perda = [];
  for (let i = 0; i < convPerdaDisp.length; i++) {
    const row = convPerdaDisp[i];
    const perc = row
      .map(x => parsePTNumber_(x, true))
      .filter(x => x !== null);
    conv.push(perc[0] ?? 0);
    perda.push(perc[1] ?? 0);
  }

  if (!force) {
    const allZero = [...vmt, ...conv, ...perda].every(x => !x || Number(x) === 0);
    if (allZero) return;
  }

  // Week label
  const now = new Date();
  const iso = isoWeekKey_(now);
  const baseWeek = "Week " + iso.week;
  const weekLabel = force
    ? baseWeek + " (FORCE " + Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), "dd/MM HH:mm") + ")"
    : baseWeek;

  // ====== DESTINO (Ficheiro JM) — encontra a tabela e escreve logo abaixo ======
  // A tabela começa em AS e o header diz "Data/Hora"
  const anchor = findHeaderCellContains_(jm, "data/hora");
  if (!anchor) throw new Error('Não encontrei o header "Data/Hora" no Ficheiro JM.');

  const startCol = anchor.col;         // deve ser AS
  const headerRow = anchor.row;        // linha do header azul
  const firstDataRow = headerRow + 1;  // primeira linha de dados
  const numCols = 11;

  // Próxima linha vazia dentro da tabela (não é enganado por lixo lá em baixo)
  const targetRow = findNextRowInTable_(jm, startCol, firstDataRow, 300);

  // Evita duplicar semana (apenas na coluna Semana) — excepto em FORCE
  if (!force) {
    const scanRows = Math.max(1, targetRow - firstDataRow);
    const weeks = jm.getRange(firstDataRow, startCol + 1, scanRows, 1).getDisplayValues().flat().map(s => String(s||"").trim());
    if (weeks.includes(baseWeek)) return;
  }

  const rowOut = [
    now,
    weekLabel,
    vmt[0], conv[0], perda[0],   // PS
    vmt[1], conv[1], perda[1],   // FO
    vmt[2], conv[2], perda[2],   // ADB
  ];

  jm.getRange(targetRow, startCol, 1, numCols).setValues([rowOut]);

  // formatos iguais ao histórico
  jm.getRange(targetRow, startCol).setNumberFormat("yyyy/mm/dd hh:mm:ss");
  jm.getRange(targetRow, startCol + 2, 1, 1).setNumberFormat("#,##0 \"€\"");
  jm.getRange(targetRow, startCol + 5, 1, 1).setNumberFormat("#,##0 \"€\"");
  jm.getRange(targetRow, startCol + 8, 1, 1).setNumberFormat("#,##0 \"€\"");
  jm.getRange(targetRow, startCol + 3, 1, 1).setNumberFormat("0.00%");
  jm.getRange(targetRow, startCol + 6, 1, 1).setNumberFormat("0.00%");
  jm.getRange(targetRow, startCol + 9, 1, 1).setNumberFormat("0.00%");
  jm.getRange(targetRow, startCol + 4, 1, 1).setNumberFormat("0.00%");
  jm.getRange(targetRow, startCol + 7, 1, 1).setNumberFormat("0.00%");
  jm.getRange(targetRow, startCol + 10, 1, 1).setNumberFormat("0.00%");
}

/** Trigger semanal ao Sábado (corre UMA vez manualmente) */
function setupTrigger_Sabado_SnapshotJM() {
  const fn = "snapshotSemanal_DashboardParaJM";

  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === fn) ScriptApp.deleteTrigger(t);
  });

  ScriptApp.newTrigger(fn)
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SATURDAY)
    .atHour(0) // 00:00-01:00
    .create();
}

/* ===== helpers robustos ===== */

/** Encontra header por "contains" (resiste a espaços/merge) */
function findHeaderCellContains_(sheet, needleLower) {
  const r = sheet.getDataRange();
  const vals = r.getDisplayValues();
  const baseRow = r.getRow();
  const baseCol = r.getColumn();

  for (let i = 0; i < vals.length; i++) {
    for (let j = 0; j < vals[i].length; j++) {
      const s = String(vals[i][j] || "").trim().toLowerCase();
      if (s && s.includes(needleLower)) return { row: baseRow + i, col: baseCol + j };
    }
  }
  return null;
}

/**
 * Acha a próxima linha vazia olhando só para a coluna Data/Hora dentro da tabela.
 * Isto evita o caso "AS431" por causa de lixo no fim da folha.
 */
function findNextRowInTable_(sheet, startCol, firstDataRow, maxRowsScan) {
  const scanRows = maxRowsScan || 300;
  const vals = sheet.getRange(firstDataRow, startCol, scanRows, 1).getDisplayValues().flat();

  let lastFilledOffset = -1;
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i] || "").trim() !== "") lastFilledOffset = i;
  }

  if (lastFilledOffset === -1) return firstDataRow;
  return firstDataRow + lastFilledOffset + 1;
}

/**
 * Converte PT:
 * - "521 €" -> 521
 * - "2,45%" -> 0.0245 (percent=true)
 */
function parsePTNumber_(s, percent) {
  s = (s || "").trim();
  if (!s) return null;

  const hasPercent = s.includes("%");
  s = s.replace(/[€\s]/g, "").replace("%", "");
  s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (!isFinite(n)) return null;

  if (percent || hasPercent) return n / 100;
  return n;
}

/** ISO week */
function isoWeekKey_(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week, key: `${d.getUTCFullYear()}-W${String(week).padStart(2,"0")}` };
}

/* =========================================================
   API — Log Tarefas Dashboard <-> Google Sheets
   Versão com leitura robusta de células agrupadas/merged.

   IMPORTANTE:
   Substitui o bloco antigo da API Log Tarefas por este bloco.
   Não apagues o restante Apps Script do ficheiro.
   ========================================================= */

const TASK_LOG_SHEET_NAME = 'Log Tarefas';
const TASK_LOG_DB_SHEET_NAME = 'Log Tarefas DB';
const TASK_LOG_TOKEN = '2860';
const TASK_LOG_SPREADSHEET_ID = '1NdCeyxLExmZtGmdQ6m63Iv2XCzzWiUnadWj4UOwmJjM';
const TASK_LOG_DB_HEADERS = ['ID', 'Data', 'Hora', 'Tarefa', 'Categoria', 'Estado', 'Notas', 'Responsável', 'Criado em', 'Atualizado em'];

function getTaskLogSheet_() {
  const spreadsheet = SpreadsheetApp.openById(TASK_LOG_SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(TASK_LOG_SHEET_NAME);
  if (!sheet) throw new Error('Folha "Log Tarefas" não encontrada.');
  return sheet;
}

function getTaskLogDbSheet_() {
  const spreadsheet = SpreadsheetApp.openById(TASK_LOG_SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(TASK_LOG_DB_SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(TASK_LOG_DB_SHEET_NAME);
    sheet.getRange(1, 1, 1, TASK_LOG_DB_HEADERS.length).setValues([TASK_LOG_DB_HEADERS]);
    sheet.setFrozenRows(1);
    migrateLegacyTaskLog_(sheet);
    sheet.hideSheet();
  } else if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, TASK_LOG_DB_HEADERS.length).setValues([TASK_LOG_DB_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function taskLogDbRow_(entry) {
  const now = new Date().toISOString();
  return [entry.id || Utilities.getUuid(), entry.date || '', entry.hour || '', entry.task || '', entry.category || 'Outro', entry.status || '—', entry.notes || '', entry.owner || '', entry.createdAt || now, entry.updatedAt || now];
}

function taskLogEntryFromDbRow_(row, rowNumber) {
  return { id: String(row[0] || 'db-r' + rowNumber), source: 'sheet', row: rowNumber, date: String(row[1] || ''), hour: String(row[2] || ''), task: String(row[3] || ''), category: String(row[4] || 'Outro'), status: String(row[5] || '—'), notes: String(row[6] || ''), owner: String(row[7] || ''), createdAt: String(row[8] || ''), updatedAt: String(row[9] || '') };
}

function migrateLegacyTaskLog_(dbSheet) {
  const entries = readTaskLogEntriesLegacy_();
  if (!entries.length) return;
  const rows = entries.reverse().map(entry => taskLogDbRow_(entry));
  dbSheet.getRange(2, 1, rows.length, TASK_LOG_DB_HEADERS.length).setValues(rows);
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

    if (p.action === 'batchAppend') {
      const entries = JSON.parse(p.entries || '[]');
      if (!Array.isArray(entries) || !entries.length) {
        return taskLogJsonp_(callback, { ok: false, error: 'Lote vazio.' });
      }
      const batchLock = LockService.getScriptLock();
      if (!batchLock.tryLock(30000)) throw new Error('Log Tarefas ocupado por outra gravação. Tenta novamente.');
      try {
        const result = appendTaskLogBatch_(entries);
        return taskLogJsonp_(callback, { ok: true, rows: result.rows, count: result.count });
      } finally {
        batchLock.releaseLock();
      }
    }

    if (p.action !== 'append' && p.action !== 'update') {
      return taskLogJsonp_(callback, { ok: false, error: 'Ação inválida.' });
    }

    const entry = {
      id: p.id || '',
      date: p.date || '',
      hour: p.hour || '',
      task: p.task || '',
      category: p.category || '',
      status: p.status || '',
      notes: p.notes || '',
      owner: p.owner || '',
      createdAt: p.createdAt || '',
    };

    if (!entry.task) {
      return taskLogJsonp_(callback, { ok: false, error: 'Tarefa vazia.' });
    }

    const oldEntry = {
      id: p.oldId || '',
      date: p.oldDate || '',
      hour: p.oldHour || '',
      task: p.oldTask || '',
      category: p.oldCategory || '',
      status: p.oldStatus || '',
      notes: p.oldNotes || '',
    };

    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('Log Tarefas ocupado por outra gravação. Tenta novamente.');
    }

    try {
      const result = p.action === 'update'
        ? updateTaskLogEntry_(entry, oldEntry)
        : appendTaskLogEntry_(entry);
      return taskLogJsonp_(callback, { ok: true, row: result.row, mode: result.mode });
    } finally {
      lock.releaseLock();
    }

  } catch (err) {
    return taskLogJsonp_(callback, {
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
  }
}

/* ---------- LEITURA ROBUSTA COM MERGES ---------- */

function readTaskLogEntriesMerged_() {
  const sheet = getTaskLogDbSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, TASK_LOG_DB_HEADERS.length)
    .getDisplayValues()
    .map((row, index) => taskLogEntryFromDbRow_(row, index + 2))
    .filter(entry => entry.task)
    .reverse();
}

function readTaskLogEntriesLegacy_() {
  const sheet = getTaskLogSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];

  const range = sheet.getRange(1, 1, lastRow, 5);
  const values = range.getDisplayValues();
  const baseRow = range.getRow();
  const baseCol = range.getColumn();
  const mergeMap = buildTaskLogMergeMap_(range, values, baseRow, baseCol);

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
    if (!task) continue;

    const minute = taskLogTimeToMinutes_(cells[0]);
    if (minute === null) continue;

    const taskMerge = taskLogMergeForCell_(mergeMap, r, 1);
    const uniqueKey = [taskLogDateKey_(currentDate), taskMerge ? taskMerge.topRow : r, taskMerge ? taskMerge.topCol : 1, task].join('|');
    if (seen[uniqueKey]) continue;
    seen[uniqueKey] = true;

    const endMinute = taskMerge
      ? taskLogMergedEndMinute_(values, taskMerge, minute)
      : minute + 15;

    entries.push({
      id: 'sheet-r' + (baseRow + r),
      source: 'sheet',
      row: baseRow + r,
      date: taskLogDateKey_(currentDate),
      hour: taskLogMinutesToTime_(minute) + '-' + taskLogMinutesToTime_(Math.max(minute + 15, endMinute)),
      task: task,
      category: String(cells[2] || 'Outro').trim() || 'Outro',
      status: String(cells[3] || '—').trim() || '—',
      notes: String(cells[4] || '').trim(),
      createdAt: '',
    });
  }

  return entries.reverse();
}

function buildTaskLogMergeMap_(dataRange, values, baseRow, baseCol) {
  const map = {};
  const merged = dataRange.getMergedRanges();

  merged.forEach(rg => {
    const topRow = rg.getRow() - baseRow;
    const topCol = rg.getColumn() - baseCol;
    const numRows = rg.getNumRows();
    const numCols = rg.getNumColumns();
    if (topRow < 0 || topCol < 0 || topCol >= 5) return;

    const value = values[topRow] && values[topRow][topCol] ? String(values[topRow][topCol]).trim() : '';
    const info = { topRow, topCol, numRows, numCols, value };

    const lastCol = Math.min(topCol + numCols, 5);
    for (let rr = topRow; rr < topRow + numRows; rr++) {
      for (let cc = topCol; cc < lastCol; cc++) {
        map[rr + ':' + cc] = info;
      }
    }
  });

  return map;
}

function taskLogMergeForCell_(mergeMap, row, col) {
  return mergeMap[row + ':' + col] || null;
}

function taskLogEffectiveCell_(values, mergeMap, row, col) {
  const raw = values[row] && values[row][col] != null ? String(values[row][col]).trim() : '';
  if (raw) return raw;
  const merged = taskLogMergeForCell_(mergeMap, row, col);
  return merged && merged.value ? merged.value : '';
}

function taskLogMergedEndMinute_(values, merge, fallbackStart) {
  let lastMinute = fallbackStart;
  const lastRow = merge.topRow + merge.numRows - 1;
  for (let r = merge.topRow; r <= lastRow && r < values.length; r++) {
    const m = taskLogTimeToMinutes_(values[r] && values[r][0]);
    if (m !== null) lastMinute = m;
  }
  return lastMinute + 15;
}

/* ---------- ESCRITA / EDIÇÃO ---------- */

function appendTaskLogEntry_(entry) {
  const sheet = getTaskLogDbSheet_();
  const existingRow = findExistingTaskRow_(sheet, entry);
  if (existingRow) {
    syncTaskLogVisualForEntries_([entry]);
    return { row: existingRow, mode: 'db-existing' };
  }
  const row = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(row, 1, 1, TASK_LOG_DB_HEADERS.length).setValues([taskLogDbRow_(entry)]);
  SpreadsheetApp.flush();
  syncTaskLogVisualForEntries_([entry]);
  return { row, mode: 'db-append' };
}

function updateTaskLogEntry_(entry, oldEntry) {
  const sheet = getTaskLogDbSheet_();
  const existingRow = findExistingTaskRow_(sheet, oldEntry) || findExistingTaskRow_(sheet, entry);
  const row = existingRow || Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(row, 1, 1, TASK_LOG_DB_HEADERS.length).setValues([taskLogDbRow_({ ...entry, id: entry.id || oldEntry.id || Utilities.getUuid(), updatedAt: new Date().toISOString() })]);
  SpreadsheetApp.flush();
  syncTaskLogVisualForEntries_([oldEntry, entry]);
  return { row, mode: existingRow ? 'db-update' : 'db-update-fallback' };
}

function appendTaskLogBatch_(entries) {
  const sheet = getTaskLogDbSheet_();
  const validEntries = entries.filter(entry => entry && entry.task);
  if (!validEntries.length) throw new Error('O lote não contém tarefas válidas.');

  const lastRow = sheet.getLastRow();
  const knownIds = lastRow < 2
    ? {}
    : sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().reduce((known, row) => {
        const id = String(row[0] || '').trim();
        if (id) known[id] = true;
        return known;
      }, {});
  const newEntries = validEntries.filter(entry => {
    const id = String(entry.id || '').trim();
    if (!id) return true;
    if (knownIds[id]) return false;
    knownIds[id] = true;
    return true;
  });
  const startRow = Math.max(sheet.getLastRow() + 1, 2);
  const rows = newEntries.map(entry => taskLogDbRow_(entry));
  if (rows.length) {
    sheet.getRange(startRow, 1, rows.length, TASK_LOG_DB_HEADERS.length).setValues(rows);
    SpreadsheetApp.flush();
  }
  syncTaskLogVisualForEntries_(validEntries);
  return { rows: rows.map((_, index) => startRow + index), count: validEntries.length };
}

function syncTaskLogVisualForEntries_(entries) {
  const keys = {};
  entries.filter(entry => entry && entry.date && entry.hour).forEach(entry => {
    keys[entry.date + '|' + taskLogStartHour_(entry.hour)] = true;
  });
  const targetKeys = Object.keys(keys);
  if (!targetKeys.length) return;

  const dbSheet = getTaskLogDbSheet_();
  const visualSheet = getTaskLogSheet_();
  const lastRow = dbSheet.getLastRow();
  const dbEntries = lastRow < 2 ? [] : dbSheet
    .getRange(2, 1, lastRow - 1, TASK_LOG_DB_HEADERS.length)
    .getDisplayValues()
    .map((row, index) => taskLogEntryFromDbRow_(row, index + 2));

  targetKeys.forEach(key => {
    const separator = key.indexOf('|');
    const date = key.slice(0, separator);
    const startHour = key.slice(separator + 1);
    const matches = dbEntries.filter(entry => entry.date === date && taskLogStartHour_(entry.hour) === startHour);
    const targetRow = findTaskTargetRow_(visualSheet, date, startHour);
    if (!targetRow) throw new Error('Não foi encontrado o período ' + date + ' ' + startHour + ' na folha "Log Tarefas".');

    if (!matches.length) {
      clearTaskMergedBlock_(visualSheet, targetRow, startHour + '-' + taskLogMinutesToTime_(taskLogTimeToMinutes_(startHour) + 15));
      return;
    }

    const unique = values => values.map(value => String(value || '').trim()).filter((value, index, all) => value && all.indexOf(value) === index);
    const tasks = unique(matches.map(entry => entry.task));
    const categories = unique(matches.map(entry => entry.category));
    const statuses = unique(matches.map(entry => entry.status));
    const notes = unique(matches.map(entry => entry.notes));
    const allowedCategories = ['Design', 'Marketing', 'Sistemas', 'Reunião', 'Vídeo', 'Outro', 'Almoço'];
    const category = categories.length === 1 && allowedCategories.indexOf(categories[0]) !== -1 ? categories[0] : 'Outro';
    const endMinutes = Math.max.apply(null, matches.map(entry => {
      const times = String(entry.hour || '').match(/\d{1,2}:\d{2}/g) || [];
      return taskLogTimeToMinutes_(times[1]) || taskLogTimeToMinutes_(startHour) + 15;
    }));
    writeTaskRowMerged_(visualSheet, targetRow, {
      hour: startHour + '-' + taskLogMinutesToTime_(endMinutes),
      task: tasks.join('\n'),
      category: category,
      status: statuses.length === 1 ? statuses[0] : '✅ Feito',
      notes: notes.join('\n'),
    });
  });
}

function writeTaskRowMerged_(sheet, row, entry, oldEntry) {
  if (oldEntry && oldEntry.hour) {
    const oldTopRow = findExistingTaskRow_(sheet, oldEntry) || row;
    clearTaskMergedBlock_(sheet, oldTopRow, oldEntry.hour);
  }

  const safeRow = taskLogTopLeftRowForWrite_(sheet, row, 2); // coluna B / Tarefa
  const numRows = taskLogRowsForHourRange_(entry.hour);

  // Só juntamos B:E. A coluna A mantém as horas de 15 em 15 minutos.
  const writeRange = sheet.getRange(safeRow, 2, numRows, 4);
  breakApartIntersectingMerges_(writeRange);
  writeRange.clearContent();

  sheet.getRange(safeRow, 1).setValue(taskLogStartHour_(entry.hour));
  sheet.getRange(safeRow, 2).setValue(entry.task);
  sheet.getRange(safeRow, 3).setValue(entry.category);
  sheet.getRange(safeRow, 4).setValue(entry.status);
  sheet.getRange(safeRow, 5).setValue(entry.notes);

  if (numRows > 1) {
    sheet.getRange(safeRow, 2, numRows, 1).mergeVertically();
    sheet.getRange(safeRow, 3, numRows, 1).mergeVertically();
    sheet.getRange(safeRow, 4, numRows, 1).mergeVertically();
    sheet.getRange(safeRow, 5, numRows, 1).mergeVertically();
  }
}

function clearTaskMergedBlock_(sheet, row, hourRange) {
  const safeRow = taskLogTopLeftRowForWrite_(sheet, row, 2);
  const numRows = taskLogRowsForHourRange_(hourRange);
  const range = sheet.getRange(safeRow, 2, numRows, 4);
  breakApartIntersectingMerges_(range);
  range.clearContent();
}

function breakApartIntersectingMerges_(range) {
  const mergedRanges = range.getMergedRanges();
  mergedRanges.forEach(mergedRange => mergedRange.breakApart());
}

function taskLogTopLeftRowForWrite_(sheet, row, col) {
  const cell = sheet.getRange(row, col);
  const merges = cell.getMergedRanges();
  if (merges && merges.length) return merges[0].getRow();
  return row;
}

function taskLogRowsForHourRange_(hourRange) {
  const times = String(hourRange || '').match(/\d{1,2}:\d{2}/g) || [];
  const start = times[0] ? taskLogTimeToMinutes_(times[0]) : null;
  let end = times[1] ? taskLogTimeToMinutes_(times[1]) : null;
  if (start === null) return 1;
  if (end === null) end = start + 15;
  if (end <= start) end += 24 * 60;
  return Math.max(1, Math.ceil((end - start) / 15));
}

function findExistingTaskRow_(sheet, entry) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, TASK_LOG_DB_HEADERS.length).getDisplayValues();
  const targetId = String(entry.id || '').trim();
  const targetKey = [entry.date, entry.hour, entry.task, entry.category, entry.status, entry.notes].map(x => String(x || '').trim()).join('|');
  for (let i = values.length - 1; i >= 0; i--) {
    if (targetId && String(values[i][0] || '').trim() === targetId) return i + 2;
    const key = [values[i][1], values[i][2], values[i][3], values[i][4], values[i][5], values[i][6]].map(x => String(x || '').trim()).join('|');
    if (key === targetKey) return i + 2;
  }
  return null;
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
  let dayHeaderRow = null;

  for (let r = 0; r < values.length; r++) {
    const joined = taskLogNormalize_(values[r].join(' '));
    const isDayHeader = /\b\d{1,2}\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(joined);
    if (isDayHeader) {
      if (inDay && dayHeaderRow) break;
      inDay = joined.indexOf(targetDayText) !== -1;
      if (inDay) dayHeaderRow = r + 1;
      continue;
    }
    if (!inDay) continue;

    const rowHour = String(values[r][0] || '').trim();
    if (rowHour === hour) return r + 1;
  }

  const startMinutes = taskLogTimeToMinutes_(hour);
  const slot = startMinutes === null ? null : (startMinutes - 9 * 60) / 15;
  if (dayHeaderRow && slot !== null && slot >= 0 && slot <= 36 && Math.floor(slot) === slot) {
    const targetRow = dayHeaderRow + 1 + slot;
    sheet.getRange(targetRow, 1).setValue(hour);
    return targetRow;
  }
  return null;
}

/* ---------- HELPERS ---------- */

function taskLogStartHour_(hourRange) {
  const m = String(hourRange || '').match(/\d{1,2}:\d{2}/);
  return m ? m[0] : String(hourRange || '');
}

function taskLogParseIsoDate_(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function taskLogParsePtDayDate_(text, year) {
  const clean = taskLogNormalize_(text);
  const m = clean.match(/(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/);
  if (!m || !year) return null;
  const month = ['janeiro','fevereiro','marco','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'].indexOf(m[2]);
  if (month < 0) return null;
  return new Date(year, month, Number(m[1]));
}

function taskLogDateKey_(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function taskLogMonthNamePt_(monthIdx) {
  return ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'][monthIdx];
}

function taskLogNormalize_(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function taskLogTimeToMinutes_(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function taskLogMinutesToTime_(minutes) {
  const normalized = ((minutes % (24 * 60)) + (24 * 60)) % (24 * 60);
  return String(Math.floor(normalized / 60)).padStart(2, '0') + ':' + String(normalized % 60).padStart(2, '0');
}

function taskLogJsonp_(callback, payload) {
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
