import { mkdir, writeFile } from "node:fs/promises";

const API_KEY = process.env.MAILERLITE_API_KEY || process.env.API_MAILERLITE || process.env.MAILERLITE_API || process.env.API_MAILERLITE_KEY || "";
const OUT_FILE = "assets/mailerlite-newsletters.json";
const BASE_URL = "https://connect.mailerlite.com/api";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rateValue(value) {
  if (value && typeof value === "object") return num(value.float);
  return num(value);
}

function campaignDate(campaign) {
  return campaign.sent_at || campaign.finished_at || campaign.send_after || campaign.updated_at || campaign.created_at || null;
}

function campaignSubject(campaign) {
  const firstEmail = Array.isArray(campaign.emails) ? campaign.emails[0] : null;
  return campaign.subject || campaign.email_subject || firstEmail?.subject || campaign.name || "Newsletter sem assunto";
}

function normalizeCampaign(campaign) {
  const stats = campaign.stats || {};
  return {
    id: String(campaign.id || ""),
    name: campaign.name || campaignSubject(campaign),
    subject: campaignSubject(campaign),
    type: campaign.type || "",
    status: campaign.status || "",
    date: campaignDate(campaign),
    sent: num(stats.sent),
    opens: num(stats.opens_count),
    uniqueOpens: num(stats.unique_opens_count),
    openRate: rateValue(stats.open_rate),
    clicks: num(stats.clicks_count),
    uniqueClicks: num(stats.unique_clicks_count),
    clickRate: rateValue(stats.click_rate),
    unsubscribes: num(stats.unsubscribes_count),
    unsubscribeRate: rateValue(stats.unsubscribe_rate),
    spam: num(stats.spam_count),
    hardBounces: num(stats.hard_bounces_count),
    hardBounceRate: rateValue(stats.hard_bounce_rate),
    softBounces: num(stats.soft_bounces_count),
    softBounceRate: rateValue(stats.soft_bounce_rate),
    forwards: num(stats.forwards_count),
    trackOpens: Boolean(campaign.track_opens),
    previewUrl: campaign.preview_url || null
  };
}

function emptyPayload(error = "") {
  return {
    generatedAt: new Date().toISOString(),
    source: "MailerLite",
    error,
    campaigns: []
  };
}

async function requestJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json"
    }
  });

  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = { message: body };
  }

  if (!response.ok) {
    const message = data?.message || `MailerLite API respondeu ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function fetchSentCampaigns() {
  const campaigns = [];
  let page = 1;
  let lastPage = 1;

  do {
    const data = await requestJson(`/campaigns?filter[status]=sent&limit=100&page=${page}`);
    campaigns.push(...(data.data || []));
    lastPage = num(data.meta?.last_page) || page;
    page += 1;
  } while (page <= lastPage && page <= 10);

  return campaigns.map(normalizeCampaign).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

async function main() {
  await mkdir("assets", { recursive: true });

  if (!API_KEY) {
    await writeFile(OUT_FILE, JSON.stringify(emptyPayload("MAILERLITE_API_KEY não está configurada."), null, 2));
    console.log("MailerLite API key missing; wrote empty newsletter payload.");
    return;
  }

  try {
    const campaigns = await fetchSentCampaigns();
    await writeFile(OUT_FILE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: "MailerLite",
      campaigns
    }, null, 2));
    console.log(`Wrote ${campaigns.length} MailerLite campaigns to ${OUT_FILE}`);
  } catch (error) {
    await writeFile(OUT_FILE, JSON.stringify(emptyPayload(error?.message || "Erro desconhecido ao contactar MailerLite."), null, 2));
    console.log(`MailerLite fetch failed: ${error?.message || error}`);
  }
}

await main();
