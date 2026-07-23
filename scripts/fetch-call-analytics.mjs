import { mkdir, readFile, writeFile } from "node:fs/promises";

const BASE_URL = (process.env.CALL_ANALYTICS_BASE_URL || "http://192.168.1.13:3000").replace(/\/$/, "");
const OUT_FILE = "assets/call-analytics.json";
const PERIODS = ["today", "week", "month"];

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

async function fetchCallAnalytics() {
  const resolved = {};
  const requests = [
    ["stats", "/api/stats"],
    ["config", "/api/config"],
    ["leadsPanel", "/api/leads-panel?range=month"],
    ...PERIODS.flatMap((period) => [
      [`analytics:${period}`, `/api/analytics?period=${period}`],
      [`funnel:${period}`, `/api/funnel?period=${period}`],
      [`agents:${period}`, `/api/agent_summary?period=${period}`]
    ])
  ];

  for (const [key, path] of requests) {
    resolved[key] = await safeFetch(path);
  }

  const analytics = {};
  const funnel = {};
  const agents = {};
  for (const period of PERIODS) {
    analytics[period] = unwrap(resolved[`analytics:${period}`]);
    funnel[period] = unwrap(resolved[`funnel:${period}`]);
    agents[period] = unwrap(resolved[`agents:${period}`]);
  }

  return {
    generatedAt: new Date().toISOString(),
    source: BASE_URL,
    stats: unwrap(resolved.stats),
    config: unwrap(resolved.config),
    analytics,
    funnel,
    agents,
    leadsPanel: unwrap(resolved.leadsPanel),
    errors: collectErrors(resolved)
  };
}

async function main() {
  await mkdir("assets", { recursive: true });
  const previous = await readPreviousPayload();

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
