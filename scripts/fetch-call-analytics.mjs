import { mkdir, readFile, writeFile } from "node:fs/promises";

const CONFIGURED_BASE_URL = process.env.CALL_ANALYTICS_BASE_URL || "";
const BASE_URL = (CONFIGURED_BASE_URL || "http://192.168.1.13:3000").replace(/\/$/, "");
const OUT_FILE = "assets/call-analytics.json";
const PERIODS = ["today", "week", "month"];
const SELLERS = [
  { ext: "102", name: "Tiago" },
  { ext: "105", name: "Flávio" },
  { ext: "106", name: "Nelson" }
];

function aggregateDashboard(calls, missed, unanswered) {
  const rows = Array.isArray(calls) ? calls : [];
  const total = rows.length;
  const effective = rows.filter((call) => Boolean(call?.is_effective)).length;
  const talkSec = rows
    .filter((call) => call?.disposition === "ANSWERED")
    .reduce((sum, call) => sum + Number(call?.talk_time || 0), 0);
  const hourly = {};
  for (const call of rows) {
    const rawDate = call?.call_date || "";
    const hour = Number(String(rawDate).slice(11, 13));
    if (!Number.isFinite(hour)) continue;
    hourly[hour] ||= { hour, total: 0, effective: 0 };
    hourly[hour].total += 1;
    if (call?.is_effective) hourly[hour].effective += 1;
  }
  return {
    total,
    effective,
    talk_sec: talkSec,
    talk_min: Math.round(talkSec / 60),
    missed_count: Array.isArray(missed) ? missed.length : 0,
    unanswered_count: Array.isArray(unanswered) ? unanswered.length : 0,
    hourly: Object.values(hourly).sort((a, b) => a.hour - b.hour)
  };
}

async function readPreviousPayload() {
  try {
    return JSON.parse(await readFile(OUT_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function fetchJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`${path} respondeu ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function safeFetch(path) {
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return { ok: true, data: await fetchJson(path) };
    } catch (error) {
      lastError = error?.message || String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  return { ok: false, error: lastError };
}

function unwrap(result) {
  return result.ok ? result.data : null;
}

function collectErrors(entries) {
  return Object.entries(entries)
    .filter(([, result]) => result && !result.ok)
    .map(([key, result]) => `${key}: ${result.error}`);
}

function ageLabel(hours) {
  const n = Number(hours || 0);
  if (!Number.isFinite(n)) return "—";
  if (n < 1) return `${Math.max(1, Math.round(n * 60))}min`;
  if (n < 24) return `${Math.round(n)}h`;
  return `${Math.round(n / 24)}d`;
}

function sanitizeLead(lead, index = 0) {
  if (!lead) return null;
  return {
    id: lead.id ? `lead-${index + 1}` : null,
    name: lead.name ? `Lead ${index + 1}` : "Lead",
    theme: lead.theme || "Indefinido",
    ano: lead.ano || "",
    stage: lead.stage || "Lead",
    status: lead.status || "pending",
    p: Number(lead.p || 0),
    score: Number(lead.score || 0),
    value: Number(lead.value || 0),
    owner_ext: lead.owner_ext || "",
    owner_name: lead.owner_name || "",
    age_hours: Number(lead.age_hours || 0),
    age_label: ageLabel(lead.age_hours),
    is_fresh: Boolean(lead.is_fresh),
    has_phone: Boolean(lead.phone),
    has_vehicle: Boolean(lead.ano)
  };
}

function summarizeAgenda(items) {
  const rows = Array.isArray(items) ? items : [];
  const byStatus = {};
  const byType = {};
  for (const row of rows) {
    const status = row.status || "sem estado";
    const type = row.tipo || "sem tipo";
    byStatus[status] = (byStatus[status] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
  }
  return {
    count: rows.length,
    byStatus,
    byType,
    preview: rows.slice(0, 8).map((row, index) => ({
      time: row.time || "",
      lead: `Lead ${index + 1}`,
      tipo: row.tipo || "",
      status: row.status || "",
      has_context: Boolean(row.ctx),
      call_time: row.call_time || ""
    }))
  };
}

function summarizeQueue(queuePayload) {
  const rows = Array.isArray(queuePayload?.queue) ? queuePayload.queue : [];
  return {
    total: Number(queuePayload?.total || rows.length || 0),
    by_theme: queuePayload?.by_theme || {},
    by_p: queuePayload?.by_p || {},
    by_status: queuePayload?.by_status || {},
    preview: rows.slice(0, 20).map((lead, index) => sanitizeLead(lead, index)).filter(Boolean)
  };
}

async function fetchCallAnalytics() {
  const resolved = {};
  const requests = [
    ["stats", "/api/stats"],
    ["config", "/api/config"],
    ["leadsPanel", "/api/leads-panel?range=month"],
    ["leadsPanelDaily", "/api/leads-panel?range=daily"],
    ["leadsPanelWeekly", "/api/leads-panel?range=weekly"],
    ["manualRevenue", "/api/manual-revenue"],
    ["cockpitPipeline", "/api/cockpit/pipeline"],
    ["cockpitAdoption", "/api/cockpit/adoption"],
    ["cockpitQueue", "/api/queue?limit=300"],
    ["kpiHistory", "/api/kpi-history"],
    ...PERIODS.flatMap((period) => [
      [`calls:${period}`, `/api/calls?period=${period}`],
      [`missed:${period}`, `/api/missed?period=${period}`],
      [`unanswered:${period}`, `/api/unanswered?period=${period}`],
      [`analytics:${period}`, `/api/analytics?period=${period}`],
      [`funnel:${period}`, `/api/funnel?period=${period}`],
      [`agents:${period}`, `/api/agent_summary?period=${period}`]
    ]),
    ...SELLERS.flatMap((seller) => [
      [`cockpitPerf:${seller.ext}`, `/api/cockpit/perf?seller=${seller.ext}`],
      [`cockpitNext:${seller.ext}`, `/api/cockpit/next?seller=${seller.ext}`],
      [`cockpitAgenda:${seller.ext}`, `/api/cockpit/agenda?seller=${seller.ext}`]
    ])
  ];

  for (const [key, path] of requests) {
    resolved[key] = await safeFetch(path);
  }

  const analytics = {};
  const funnel = {};
  const agents = {};
  const dashboard = {};
  for (const period of PERIODS) {
    analytics[period] = unwrap(resolved[`analytics:${period}`]);
    funnel[period] = unwrap(resolved[`funnel:${period}`]);
    agents[period] = unwrap(resolved[`agents:${period}`]);
    dashboard[period] = aggregateDashboard(
      unwrap(resolved[`calls:${period}`]),
      unwrap(resolved[`missed:${period}`]),
      unwrap(resolved[`unanswered:${period}`])
    );
  }

  const cockpitSellers = SELLERS.map((seller, index) => {
    const perf = unwrap(resolved[`cockpitPerf:${seller.ext}`]) || {};
    const next = unwrap(resolved[`cockpitNext:${seller.ext}`]) || {};
    const agenda = unwrap(resolved[`cockpitAgenda:${seller.ext}`]) || {};
    return {
      ext: seller.ext,
      name: perf.name || next.seller_name || seller.name,
      perf,
      next: {
        assignment: next.assignment || "",
        seller: next.seller || seller.ext,
        seller_name: next.seller_name || seller.name,
        lead: sanitizeLead(next.lead, index)
      },
      agenda: summarizeAgenda(agenda.items)
    };
  });

  const queue = summarizeQueue(unwrap(resolved.cockpitQueue));

  return {
    generatedAt: new Date().toISOString(),
    source: BASE_URL,
    stats: unwrap(resolved.stats),
    config: unwrap(resolved.config),
    analytics,
    funnel,
    agents,
    dashboard,
    cockpit: {
      sellers: cockpitSellers,
      pipeline: unwrap(resolved.cockpitPipeline),
      adoption: unwrap(resolved.cockpitAdoption),
      queue,
      leadsPanel: {
        daily: unwrap(resolved.leadsPanelDaily),
        weekly: unwrap(resolved.leadsPanelWeekly),
        monthly: unwrap(resolved.leadsPanel)
      },
      kpiHistory: unwrap(resolved.kpiHistory)
    },
    manualRevenue: unwrap(resolved.manualRevenue),
    leadsPanel: unwrap(resolved.leadsPanel),
    errors: collectErrors(resolved)
  };
}

async function main() {
  await mkdir("assets", { recursive: true });
  const previous = await readPreviousPayload();

  if (process.env.GITHUB_ACTIONS === "true" && !CONFIGURED_BASE_URL) {
    if (previous) {
      await writeFile(OUT_FILE, JSON.stringify({
        ...previous,
        generatedAt: new Date().toISOString(),
        stale: true,
        error: "PKE Call Analytics é uma fonte de rede local; GitHub Action manteve o último snapshot publicado."
      }, null, 2));
      console.log("Call Analytics local source skipped on GitHub Actions; preserved previous snapshot.");
      return;
    }
  }

  try {
    const payload = await fetchCallAnalytics();
    const hasUsefulData = payload.stats || payload.config || payload.analytics.month || payload.funnel.month || payload.agents.month || payload.leadsPanel;
    if (!hasUsefulData && previous) {
      await writeFile(OUT_FILE, JSON.stringify({
        ...previous,
        generatedAt: new Date().toISOString(),
        stale: true,
        error: "Não foi possível contactar o PKE Call Analytics; mantive o último snapshot disponível.",
        errors: payload.errors
      }, null, 2));
      console.log("Call Analytics unreachable; preserved previous snapshot.");
      return;
    }
    await writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`Wrote Call Analytics snapshot to ${OUT_FILE}`);
  } catch (error) {
    if (previous) {
      await writeFile(OUT_FILE, JSON.stringify({
        ...previous,
        generatedAt: new Date().toISOString(),
        stale: true,
        error: error?.message || "Erro desconhecido ao contactar o PKE Call Analytics."
      }, null, 2));
      console.log("Call Analytics fetch failed; preserved previous snapshot.");
      return;
    }
    await writeFile(OUT_FILE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: BASE_URL,
      error: error?.message || "Erro desconhecido ao contactar o PKE Call Analytics.",
      stats: null,
      config: null,
      analytics: {},
      funnel: {},
      agents: {},
      leadsPanel: null
    }, null, 2));
    console.log(`Call Analytics fetch failed: ${error?.message || error}`);
  }
}

await main();
