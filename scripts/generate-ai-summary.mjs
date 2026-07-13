import fs from "node:fs/promises";

const SHEET_ID = "1NdCeyxLExmZtGmdQ6m63Iv2XCzzWiUnadWj4UOwmJjM";
const VSP_RESULTS_SHEET_ID = "1uEZW2WNYacxLNfb9isMrgvwCng6bHDUZPxfNqgakcZo";
const DASHBOARD_GID = "1179921659";
const SHEET_GIDS = {
  "Leads Diarios": "1508480304"
};
const MONTH_NAMES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const SECTION_HEADERS = new Set([
  "PROPOSTAS OBJECTIVADAS (C/ IVA)",
  "PROPOSTAS REAIS (C/ IVA)",
  "PROPOSTAS OBJECTIVADAS (S/ IVA)",
  "PROPOSTAS REAIS (S/ IVA)",
  "ENCOMENDAS OBJETIVADAS (S/ IVA)",
  "ENCOMENDAS REAIS (S/ IVA)",
  "FATURACAO OBJETIVADA (S/ IVA)",
  "FATURACAO REAL (S/ IVA)"
]);

function normalizeLabel(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseGviz(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Resposta Google Sheets invalida.");
  const json = JSON.parse(text.slice(start, end + 1));
  if (json.status === "error") {
    const error = json.errors && json.errors[0];
    throw new Error(error?.detailed_message || error?.message || "Erro ao ler Google Sheets.");
  }
  return json.table;
}

async function fetchSheet({ spreadsheetId = SHEET_ID, gid, sheet, headers }) {
  const params = new URLSearchParams();
  if (gid) params.set("gid", gid);
  if (sheet) params.set("sheet", sheet);
  if (headers !== undefined) params.set("headers", String(headers));
  params.set("tqx", "out:json");
  const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao ler Google Sheets (${res.status})`);
  return parseGviz(await res.text());
}

function cell(row, idx) {
  const c = row?.c?.[idx];
  if (!c) return "";
  if (c.f !== undefined && c.f !== null && c.f !== "") return c.f;
  if (c.v !== undefined && c.v !== null) return c.v;
  return "";
}

function num(value) {
  if (typeof value === "number") return value;
  const cleaned = String(value || "")
    .replace(/[€%]/g, "")
    .replace(/\s|\u00a0/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDate(row, idx) {
  const raw = String(cell(row, idx) || "");
  let match = raw.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]), Number(match[3]));
  match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function topCounts(rows, getLabel, limit = 8) {
  const counts = new Map();
  for (const row of rows) {
    const label = String(getLabel(row) || "Sem origem").trim() || "Sem origem";
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function avg(values) {
  const clean = values.filter((v) => Number.isFinite(v) && v > 0);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}

function landingLabel(url) {
  const raw = String(url || "").trim();
  if (!raw) return "Sem landing page";
  try {
    const path = new URL(raw).pathname.replace(/^\/+|\/+$/g, "");
    return path ? path.split("/").pop() : raw.replace(/^https?:\/\//, "");
  } catch {
    return raw.replace(/^https?:\/\/(www\.)?pke\.pt\/?/, "") || raw;
  }
}

function trafficSource(row) {
  const source = String(cell(row, 11) || "").toLowerCase();
  const origin = String(cell(row, 4) || "").toLowerCase();
  if (source.includes("meta") || source === "fb" || cell(row, 17)) return "Meta Ads";
  if (source.includes("gad") || source.includes("google") || cell(row, 16)) return "Google Ads";
  if (origin.includes("scorecard")) return "Scorecard";
  if (origin.includes("vsp")) return "VSP";
  return cell(row, 11) || cell(row, 4) || "Sem origem";
}

function symptomList(row) {
  return String(cell(row, 23) || "").split("|").map((s) => s.trim()).filter(Boolean);
}

function isScorecard(row) {
  return String(cell(row, 4) || "").toLowerCase().includes("scorecard") || num(cell(row, 20)) > 0 || num(cell(row, 22)) > 0;
}

function isReplacementIntent(row) {
  const trend = String(cell(row, 21) || "").toLowerCase();
  return trend.includes("substit") || trend.includes("mista");
}

function summarizeDashboard(table) {
  const sections = [];
  let current = null;
  for (const row of table.rows || []) {
    const label = normalizeLabel(cell(row, 0));
    if (SECTION_HEADERS.has(label)) {
      current = { section: label, rows: [] };
      sections.push(current);
      continue;
    }
    if (!current) continue;
    const rowLabel = [cell(row, 0), cell(row, 1), cell(row, 2), cell(row, 3), cell(row, 4)]
      .filter(Boolean)
      .join(" / ");
    const monthly = Array.from({ length: 12 }, (_, i) => num(cell(row, 5 + i)));
    const total = monthly.reduce((a, b) => a + b, 0);
    if (rowLabel && total) current.rows.push({ label: rowLabel, total, monthly });
  }
  return sections.map((section) => ({
    section: section.section,
    rows: section.rows.slice(0, 12).map((row) => ({
      label: row.label,
      total: Math.round(row.total),
      monthly: row.monthly.map((v, i) => ({ month: MONTH_NAMES[i], value: Math.round(v) })).filter((v) => v.value)
    }))
  }));
}

function summarizeLeads(table) {
  const rows = (table.rows || []).filter((row) => parseDate(row, 1));
  const services = {
    PS: { valueCol: 5, countCol: 10 },
    FAP: { valueCol: 4, countCol: 9 },
    AdBlue: { valueCol: 3, countCol: 8 }
  };
  const monthly = Object.fromEntries(Object.keys(services).map((key) => [key, new Array(12).fill(0)]));
  const totals = {};
  for (const row of rows) {
    const date = parseDate(row, 1);
    if (!date) continue;
    const month = date.getMonth();
    for (const [key, cols] of Object.entries(services)) {
      monthly[key][month] += num(cell(row, cols.countCol));
    }
  }
  for (const key of Object.keys(services)) {
    totals[key] = {
      leads: monthly[key].reduce((a, b) => a + b, 0),
      monthly: monthly[key].map((value, i) => ({ month: MONTH_NAMES[i], value: Math.round(value) })).filter((v) => v.value)
    };
  }
  return { totalRows: rows.length, totals };
}

function summarizeVsp(table) {
  const rows = (table.rows || []).filter((row) => parseDate(row, 0));
  const scorecardRows = rows.filter(isScorecard);
  const symptoms = new Map();
  for (const row of scorecardRows) {
    for (const symptom of symptomList(row)) {
      symptoms.set(symptom, (symptoms.get(symptom) || 0) + 1);
    }
  }
  return {
    totalLeads: rows.length,
    scorecardCompletionRate: rows.length ? scorecardRows.length / rows.length : 0,
    avgCleanPrice: Math.round(avg(rows.map((row) => num(cell(row, 9))))),
    avgReplacePrice: Math.round(avg(rows.map((row) => num(cell(row, 10))))),
    totalCleanPotential: Math.round(rows.reduce((sum, row) => sum + num(cell(row, 9)), 0)),
    totalReplacePotential: Math.round(rows.reduce((sum, row) => sum + num(cell(row, 10)), 0)),
    replacementIntentRate: rows.length ? rows.filter(isReplacementIntent).length / rows.length : 0,
    avgSeverity: avg(scorecardRows.map((row) => num(cell(row, 20)))),
    avgUrgency: avg(scorecardRows.map((row) => num(cell(row, 22)))),
    topSources: topCounts(rows, trafficSource, 8),
    topCampaigns: topCounts(rows, (row) => cell(row, 13) || "Sem campanha", 8),
    topLandingPages: topCounts(rows, (row) => landingLabel(cell(row, 19)), 8),
    topBrands: topCounts(rows, (row) => cell(row, 5) || "Sem marca", 8),
    topTrends: topCounts(scorecardRows, (row) => cell(row, 21) || "Sem tendencia", 5),
    topSymptoms: [...symptoms.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 10)
  };
}

function clampText(value, max = 900) {
  return String(value || "").slice(0, max);
}

async function generateAiSummary(metrics) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY nao configurada.");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const prompt = {
    instruction: "Analisa o Dashboard MKT da PKE como consultor senior de marketing e performance comercial. Usa apenas os dados agregados fornecidos. Nao inventes dados. Responde em portugues de Portugal, de forma objetiva e acionavel.",
    requiredJson: {
      status: "good|attention|risk",
      healthScore: "numero de 0 a 100",
      headline: "frase curta",
      executiveSummary: "paragrafo curto",
      risks: ["3 a 5 riscos principais"],
      opportunities: ["3 a 5 oportunidades"],
      recommendedActions: ["5 acoes recomendadas"],
      next24h: ["3 prioridades para as proximas 24h"],
      weekPriorities: ["3 prioridades para a semana"],
      notes: "observacao curta sobre limites dos dados"
    },
    metrics
  };
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Devolve apenas JSON valido. Nao incluas markdown."
        },
        {
          role: "user",
          content: JSON.stringify(prompt)
        }
      ],
      temperature: 0.2
    })
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`OpenAI API falhou (${res.status}): ${clampText(body)}`);
  const parsed = JSON.parse(body);
  return JSON.parse(parsed.choices?.[0]?.message?.content || "{}");
}

async function main() {
  const [dashboardTable, leadsTable, vspTable] = await Promise.all([
    fetchSheet({ gid: DASHBOARD_GID, headers: 0 }),
    fetchSheet({ gid: SHEET_GIDS["Leads Diarios"] }),
    fetchSheet({ spreadsheetId: VSP_RESULTS_SHEET_ID })
  ]);
  const metrics = {
    generatedAt: new Date().toISOString(),
    dashboard: summarizeDashboard(dashboardTable),
    leads: summarizeLeads(leadsTable),
    vsp: summarizeVsp(vspTable)
  };
  const ai = await generateAiSummary(metrics);
  const output = {
    generatedAt: metrics.generatedAt,
    source: "github-actions-openai",
    ...ai,
    metricsSnapshot: {
      vspTotalLeads: metrics.vsp.totalLeads,
      vspScorecardCompletionRate: metrics.vsp.scorecardCompletionRate,
      leadsTotals: metrics.leads.totals
    }
  };
  await fs.writeFile("ai-summary.json", `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`AI summary generated at ${output.generatedAt}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
