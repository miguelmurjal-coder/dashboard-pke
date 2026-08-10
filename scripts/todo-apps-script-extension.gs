// Extensao para o Web App Apps Script usado pelo MCP.
// Adiciona suporte a To-do's partilhados na tab "To-do's MCP".
//
// Como usar:
// 1. Abrir o projeto Apps Script do endpoint TASK_LOG_WRITE_ENDPOINT.
// 2. Colar estas funcoes no projeto.
// 3. No doGet(e) existente, antes do switch/fluxo do Log Tarefas, adicionar:
//
//    var todoResponse = handleTodoAction_(e);
//    if (todoResponse) return jsonp_(e, todoResponse);
//
// 4. Fazer Deploy > Manage deployments > Edit > New version > Deploy.

var TODO_SHEET_NAME = "To-do's MCP";
var TODO_SPREADSHEET_ID = "1NdCeyxLExmZtGmdQ6m63Iv2XCzzWiUnadWj4UOwmJjM";
var TODO_HEADERS = ["ID", "Tarefa", "Prioridade", "Prazo", "Estado", "Notas", "Criada em", "Concluída em", "Atualizada em"];

function handleTodoAction_(e) {
  var action = String((e.parameter && e.parameter.action) || "");
  if (["todoAppend", "todoUpdate", "todoDelete", "todoClearDone", "todoRead"].indexOf(action) === -1) return null;

  try {
    var sheet = getTodoSheet_();
    if (action === "todoRead") return { ok: true, entries: readTodoRows_(sheet) };
    if (action === "todoAppend") return appendTodo_(sheet, e.parameter);
    if (action === "todoUpdate") return updateTodo_(sheet, e.parameter);
    if (action === "todoDelete") return deleteTodo_(sheet, e.parameter.id);
    if (action === "todoClearDone") return clearDoneTodos_(sheet, e.parameter.ids);
    return { ok: false, error: "Acao To-do desconhecida." };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

function getTodoSheet_() {
  var ss = SpreadsheetApp.openById(TODO_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(TODO_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(TODO_SHEET_NAME);
  ensureTodoHeaders_(sheet);
  return sheet;
}

function ensureTodoHeaders_(sheet) {
  var current = sheet.getRange(1, 1, 1, TODO_HEADERS.length).getDisplayValues()[0];
  var needsHeaders = TODO_HEADERS.some(function(header, i) { return current[i] !== header; });
  if (!needsHeaders) return;
  sheet.getRange(1, 1, 1, TODO_HEADERS.length).setValues([TODO_HEADERS]);
  sheet.setFrozenRows(1);
}

function todoRowFromParams_(p) {
  return [
    p.id || Utilities.getUuid(),
    p.title || "",
    p.priority || "Normal",
    p.dueDate || "",
    p.status || "Aberta",
    p.notes || "",
    p.createdAt || new Date().toISOString(),
    p.completedAt || "",
    p.updatedAt || new Date().toISOString()
  ];
}

function readTodoRows_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, TODO_HEADERS.length).getDisplayValues()
    .filter(function(row) { return row[1]; })
    .map(function(row) {
      return {
        id: row[0],
        title: row[1],
        priority: row[2] || "Normal",
        dueDate: row[3],
        status: row[4] || "Aberta",
        notes: row[5],
        createdAt: row[6],
        completedAt: row[7],
        updatedAt: row[8]
      };
    });
}

function findTodoRow_(sheet, id) {
  if (!id) return -1;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === id) return i + 2;
  }
  return -1;
}

function appendTodo_(sheet, p) {
  var row = todoRowFromParams_(p);
  sheet.appendRow(row);
  return { ok: true, id: row[0] };
}

function updateTodo_(sheet, p) {
  var rowNumber = findTodoRow_(sheet, p.id);
  if (rowNumber < 0) return appendTodo_(sheet, p);
  sheet.getRange(rowNumber, 1, 1, TODO_HEADERS.length).setValues([todoRowFromParams_(p)]);
  return { ok: true, id: p.id };
}

function deleteTodo_(sheet, id) {
  var rowNumber = findTodoRow_(sheet, id);
  if (rowNumber > 0) sheet.deleteRow(rowNumber);
  return { ok: true, id: id || "" };
}

function clearDoneTodos_(sheet, idsValue) {
  var ids = String(idsValue || "").split("|").filter(Boolean);
  for (var i = ids.length - 1; i >= 0; i--) {
    var rowNumber = findTodoRow_(sheet, ids[i]);
    if (rowNumber > 0) sheet.deleteRow(rowNumber);
  }
  return { ok: true, deleted: ids.length };
}
