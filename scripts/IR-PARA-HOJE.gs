/**
 * Navega para o dia atual sem alterar dados ou formatacao.
 * Associar ao desenho "Ir para hoje" no Google Sheets.
 */
function irParaHojeLogTarefas() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Log Tarefas');
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Nao foi encontrado o separador Log Tarefas.');
    return;
  }
  const today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const rows = sheet.getLastRow() ? sheet.getRange(1, 1, sheet.getLastRow(), 5).getDisplayValues() : [];
  const row = encontrarDiaLogTarefas_(rows, today);
  if (!row) {
    SpreadsheetApp.getUi().alert('O dia de hoje (' + today + ') nao existe no Log Tarefas.');
    return;
  }
  ss.setActiveSheet(sheet);
  sheet.getRange(row, 1).activate();
}

function encontrarDiaLogTarefas_(rows, isoDate) {
  const parts = isoDate.split('-').map(Number);
  const months = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  let year = parts[0];
  for (let i = 0; i < rows.length; i++) {
    const text = rows[i].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const explicitYear = text.match(/\b(20\d{2})\b/);
    if (explicitYear) year = Number(explicitYear[1]);
    if (/\bsemana\b/.test(text)) continue;
    const date = text.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
    if (date && year === parts[0] && Number(date[1]) === parts[2] && months.indexOf(date[2]) + 1 === parts[1]) return i + 1;
  }
  return null;
}
