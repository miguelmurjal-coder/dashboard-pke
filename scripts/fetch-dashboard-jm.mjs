import { mkdir, readFile, writeFile } from "node:fs/promises";

const SOURCE_URL = process.env.DASHBOARD_JM_URL || "https://dashboard-jm.neocities.org/";
const SOURCE_FILE = process.env.DASHBOARD_JM_SOURCE_FILE || "";
const OUT_FILE = "assets/dashboard-jm.json";
const SERVICE_KEYS = ["ps", "fo", "adb", "fs"];

function round(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function extractJsonConstant(source, name) {
  const marker = `const ${name}=`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) throw new Error(`Nao encontrei ${name} no Dashboard JM.`);
  const start = markerIndex + marker.length;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }
  throw new Error(`O bloco ${name} esta incompleto.`);
}

function sourceUpdateLabel(source) {
  const match = source.match(/Dados atualizados[\s\S]{0,160}?<strong>([^<]+)<\/strong>/i);
  return match ? match[1].trim() : "";
}

function sum(rows, key) {
  return round(rows.reduce((total, row) => total + (Number(row?.[key]) || 0), 0));
}

function serviceTotals(rows) {
  return Object.fromEntries(SERVICE_KEYS.map((key) => [key, sum(rows, key)]));
}

function backOfficeSummary(rows) {
  const services = {};
  for (const key of SERVICE_KEYS) {
    services[key] = round(rows.reduce((total, row) => total + (Number(row?.[`${key}Paid`]) || 0) + (Number(row?.[`${key}Unpaid`]) || 0), 0));
  }
  const paid = round(rows.reduce((total, row) => total + SERVICE_KEYS.reduce((part, key) => part + (Number(row?.[`${key}Paid`]) || 0), 0), 0));
  const unpaid = round(rows.reduce((total, row) => total + SERVICE_KEYS.reduce((part, key) => part + (Number(row?.[`${key}Unpaid`]) || 0), 0), 0));
  return { paid, unpaid, total: round(paid + unpaid), services };
}

function monthOf(row) {
  const month = Number(String(row?.date || "").slice(5, 7));
  return Number.isFinite(month) ? month : 0;
}

function buildPayload(source) {
  const db = extractJsonConstant(source, "DB");
  const overview = extractJsonConstant(source, "OVERVIEW_SOURCE");
  const invoices = Array.isArray(db?.invoices) ? db.invoices : [];
  const credits = Array.isArray(db?.credits) ? db.credits : [];
  const backOfficeDaily = Array.isArray(overview?.backOfficeDaily) ? overview.backOfficeDaily : [];
  const monthlyNet = Array.isArray(overview?.monthlyNet) ? overview.monthlyNet : [];
  const monthly = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const monthInvoices = invoices.filter((row) => monthOf(row) === month);
    const monthCredits = credits.filter((row) => monthOf(row) === month);
    const monthBackOffice = backOfficeDaily.filter((row) => monthOf(row) === month);
    const invoiceNet = sum(monthInvoices, "net");
    return {
      month,
      netRevenue: round(monthlyNet[index]),
      invoiceNet,
      creditNotes: sum(monthCredits, "net"),
      invoiceCount: monthInvoices.length,
      averageInvoice: monthInvoices.length ? round(invoiceNet / monthInvoices.length) : 0,
      services: serviceTotals(monthInvoices),
      backOffice: backOfficeSummary(monthBackOffice)
    };
  });
  const populatedBackOffice = backOfficeDaily.filter((row) => Number(row?.total || 0) !== 0);
  const populatedDates = [...invoices, ...credits, ...populatedBackOffice].map((row) => row?.date).filter(Boolean).sort();
  const totals = monthly.reduce((result, month) => {
    result.netRevenue += month.netRevenue;
    result.invoiceNet += month.invoiceNet;
    result.creditNotes += month.creditNotes;
    result.invoiceCount += month.invoiceCount;
    result.backOffice.paid += month.backOffice.paid;
    result.backOffice.unpaid += month.backOffice.unpaid;
    result.backOffice.total += month.backOffice.total;
    return result;
  }, { netRevenue: 0, invoiceNet: 0, creditNotes: 0, invoiceCount: 0, backOffice: { paid: 0, unpaid: 0, total: 0 } });
  totals.netRevenue = round(totals.netRevenue);
  totals.invoiceNet = round(totals.invoiceNet);
  totals.creditNotes = round(totals.creditNotes);
  totals.averageInvoice = totals.invoiceCount ? round(totals.invoiceNet / totals.invoiceCount) : 0;
  totals.backOffice.paid = round(totals.backOffice.paid);
  totals.backOffice.unpaid = round(totals.backOffice.unpaid);
  totals.backOffice.total = round(totals.backOffice.total);
  return {
    generatedAt: new Date().toISOString(),
    source: "Dashboard JM",
    sourceUrl: SOURCE_URL,
    sourceUpdatedAt: sourceUpdateLabel(source),
    dataThrough: populatedDates.at(-1) || null,
    privacy: "Apenas agregados; nomes, NIF, documentos e referencias de clientes nao sao exportados.",
    totals,
    monthly
  };
}

async function readSource() {
  if (SOURCE_FILE) return readFile(SOURCE_FILE, "utf8");
  const response = await fetch(SOURCE_URL, { headers: { Accept: "text/html" } });
  if (!response.ok) throw new Error(`Dashboard JM respondeu ${response.status}.`);
  return response.text();
}

async function main() {
  await mkdir("assets", { recursive: true });
  try {
    const payload = buildPayload(await readSource());
    await writeFile(OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`Dashboard JM: ${payload.totals.invoiceCount} documentos agregados ate ${payload.dataThrough}.`);
  } catch (error) {
    try {
      const previous = JSON.parse(await readFile(OUT_FILE, "utf8"));
      previous.stale = true;
      previous.lastError = error?.message || String(error);
      await writeFile(OUT_FILE, `${JSON.stringify(previous, null, 2)}\n`);
      console.warn(`Dashboard JM indisponivel; mantido o ultimo snapshot: ${previous.lastError}`);
    } catch {
      throw error;
    }
  }
}

await main();
