import { mkdir, readFile, writeFile } from "node:fs/promises";

const BASELINE_FILE = process.argv[2] || process.env.BASELINE_CSV || "exports/mailerlite-manual/nl-multichoice-1.csv";
const CURRENT_FILE = process.argv[3] || process.env.CURRENT_CSV || "exports/mailerlite-manual/nl-luz-painel-fap-28-07-26.csv";
const OUT_DIR = process.argv[4] || process.env.OUT_DIR || "exports/mailerlite-manual/result";

function clean(value) {
  return String(value ?? "").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function csvCell(value) {
  const text = clean(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseNumber(value) {
  const match = clean(value).replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.some((value) => clean(value))) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  if (row.some((value) => clean(value))) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return lower(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "");
}

function findColumn(headers, candidates) {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates.map(normalizeHeader)) {
    const exact = normalized.indexOf(candidate);
    if (exact >= 0) return exact;
    const includes = normalized.findIndex((header) => header.includes(candidate) || candidate.includes(header));
    if (includes >= 0) return includes;
  }
  return -1;
}

function boolFromCountOrText(value) {
  const text = lower(value);
  if (!text) return false;
  if (["no", "nao", "não", "false", "0", "-"].includes(text)) return false;
  if (parseNumber(text) > 0) return true;
  return ["yes", "sim", "true", "opened", "clicked", "aberto", "clicado"].some((word) => text.includes(word));
}

async function loadRecipients(file) {
  const csv = await readFile(file, "utf8");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new Error(`CSV vazio ou sem dados: ${file}`);

  const headers = rows[0];
  const emailCol = findColumn(headers, ["email", "e-mail", "subscriber email", "recipient email", "subscriber", "recipient"]);
  if (emailCol < 0) {
    throw new Error(`Nao encontrei coluna de email em ${file}. Cabecalhos: ${headers.join(" | ")}`);
  }

  const nameCol = findColumn(headers, ["name", "nome", "subscriber name", "recipient name"]);
  const statusCol = findColumn(headers, ["status", "state", "estado"]);
  const opensCol = findColumn(headers, ["opens", "opens count", "opens_count", "opened", "aberturas", "abriu"]);
  const clicksCol = findColumn(headers, ["clicks", "clicks count", "clicks_count", "clicked", "cliques", "clicou"]);
  const sentCol = findColumn(headers, ["sent", "sent at", "date sent", "received", "recebido", "enviado"]);

  const recipients = new Map();
  for (const raw of rows.slice(1)) {
    const email = lower(raw[emailCol]);
    if (!email || !email.includes("@")) continue;
    const existing = recipients.get(email) || {
      email,
      name: "",
      status: "",
      received: true,
      opened: false,
      clicked: false,
      opensCount: 0,
      clicksCount: 0,
      sentAt: ""
    };

    existing.name ||= nameCol >= 0 ? clean(raw[nameCol]) : "";
    existing.status ||= statusCol >= 0 ? clean(raw[statusCol]) : "";
    existing.sentAt ||= sentCol >= 0 ? clean(raw[sentCol]) : "";

    if (opensCol >= 0) {
      existing.opensCount += parseNumber(raw[opensCol]);
      existing.opened = existing.opened || boolFromCountOrText(raw[opensCol]);
    }
    if (clicksCol >= 0) {
      existing.clicksCount += parseNumber(raw[clicksCol]);
      existing.clicked = existing.clicked || boolFromCountOrText(raw[clicksCol]);
    }

    recipients.set(email, existing);
  }

  return recipients;
}

function rowsFromMap(map) {
  return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
}

async function writeCsv(name, rows) {
  const header = ["email", "name", "status", "received", "opened", "clicked", "opens_count", "clicks_count", "sent_at"];
  const csv = [
    header.join(","),
    ...rows.map((row) => [
      row.email,
      row.name,
      row.status,
      row.received ? "yes" : "no",
      row.opened ? "yes" : "no",
      row.clicked ? "yes" : "no",
      row.opensCount,
      row.clicksCount,
      row.sentAt
    ].map(csvCell).join(","))
  ].join("\n");
  await writeFile(`${OUT_DIR}/${name}`, `${csv}\n`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const baseline = await loadRecipients(BASELINE_FILE);
  const current = await loadRecipients(CURRENT_FILE);
  const baselineRows = rowsFromMap(baseline);
  const currentRows = rowsFromMap(current);

  const newSubscribers = currentRows.filter((row) => !baseline.has(row.email));
  const missingSinceBaseline = baselineRows.filter((row) => !current.has(row.email));
  const retained = currentRows.filter((row) => baseline.has(row.email));
  const baselineNoOpen = baselineRows.filter((row) => !row.opened);
  const baselineNoClick = baselineRows.filter((row) => !row.clicked);
  const baselineNoOpenNoClick = baselineRows.filter((row) => !row.opened && !row.clicked);
  const baselineNoOpenOrNoClick = baselineRows.filter((row) => !row.opened || !row.clicked);
  const inactiveStillPresent = baselineNoOpenNoClick.filter((row) => current.has(row.email));

  await Promise.all([
    writeCsv("baseline-nl-multichoice-1-all.csv", baselineRows),
    writeCsv("current-nl-luz-painel-fap-28-07-26-all.csv", currentRows),
    writeCsv("new-subscribers-current-minus-baseline.csv", newSubscribers),
    writeCsv("removed-or-not-sent-current-baseline-minus-current.csv", missingSinceBaseline),
    writeCsv("retained-subscribers-both-campaigns.csv", retained),
    writeCsv("baseline-received-no-open.csv", baselineNoOpen),
    writeCsv("baseline-received-no-click.csv", baselineNoClick),
    writeCsv("baseline-received-no-open-and-no-click.csv", baselineNoOpenNoClick),
    writeCsv("baseline-received-no-open-or-no-click.csv", baselineNoOpenOrNoClick),
    writeCsv("baseline-no-open-no-click-still-present-current.csv", inactiveStillPresent)
  ]);

  const summary = {
    baseline_file: BASELINE_FILE,
    current_file: CURRENT_FILE,
    baseline_recipients: baselineRows.length,
    current_recipients: currentRows.length,
    retained_from_baseline: retained.length,
    new_subscribers_current_minus_baseline: newSubscribers.length,
    removed_or_not_sent_current: missingSinceBaseline.length,
    baseline_no_open: baselineNoOpen.length,
    baseline_no_click: baselineNoClick.length,
    baseline_no_open_and_no_click: baselineNoOpenNoClick.length,
    baseline_no_open_or_no_click: baselineNoOpenOrNoClick.length,
    baseline_no_open_no_click_still_present_current: inactiveStillPresent.length
  };

  await writeFile(`${OUT_DIR}/summary.json`, JSON.stringify(summary, null, 2));
  await writeFile(`${OUT_DIR}/summary.csv`, `${Object.entries(summary).map((row) => row.map(csvCell).join(",")).join("\n")}\n`);

  console.log(`MultiChoice: ${baselineRows.length}`);
  console.log(`NL 28/07: ${currentRows.length}`);
  console.log(`Novos subscribers: ${newSubscribers.length}`);
  console.log(`Removidos/nao enviados na atual: ${missingSinceBaseline.length}`);
  console.log(`Resultado em ${OUT_DIR}`);
}

await main();
