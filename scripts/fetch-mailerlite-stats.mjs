import { mkdir, writeFile } from "node:fs/promises";

const API_KEY = process.env.MAILERLITE_API_KEY || process.env.API_MAILERLITE || process.env.MAILERLITE_API || process.env.API_MAILERLITE_KEY || "";
const OUT_FILE = "assets/mailerlite-newsletters.json";
const BASE_URL = "https://api.mailerlite.com/api/v2";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function rateValue(value) {
  const raw = value && typeof value === "object" ? num(value.float) : num(value);
  return raw > 1 ? raw / 100 : raw;
}

function campaignDate(campaign) {
  return campaign.date_send || campaign.sent_at || campaign.finished_at || campaign.send_after || campaign.updated_at || campaign.created_at || campaign.date_created || null;
}

function campaignSubject(campaign) {
  const firstEmail = Array.isArray(campaign.emails) ? campaign.emails[0] : null;
  return campaign.subject || campaign.email_subject || firstEmail?.subject || campaign.name || "Newsletter sem assunto";
}

function normalizeCampaign(campaign) {
  const stats = campaign.stats || {};
  const opened = campaign.opened || {};
  const clicked = campaign.clicked || {};
  const recipients = campaign.recipients || campaign.total_recipients || stats.sent || 0;
  const openRate = opened.rate ?? stats.open_rate;
  const clickRate = clicked.rate ?? stats.click_rate;
  return {
    id: String(campaign.id || ""),
    name: campaign.name || campaignSubject(campaign),
    subject: campaignSubject(campaign),
    type: campaign.type || "",
    status: campaign.status || "",
    date: campaignDate(campaign),
    sent: num(recipients),
    opens: num(opened.count ?? stats.opens_count),
    uniqueOpens: num(opened.count ?? stats.unique_opens_count ?? stats.opens_count),
    openRate: rateValue(openRate),
    clicks: num(clicked.count ?? stats.clicks_count),
    uniqueClicks: num(clicked.count ?? stats.unique_clicks_count ?? stats.clicks_count),
    clickRate: rateValue(clickRate),
    unsubscribes: num(stats.unsubscribes_count),
    unsubscribeRate: rateValue(stats.unsubscribe_rate),
    spam: num(stats.spam_count),
    hardBounces: num(stats.hard_bounces_count),
    hardBounceRate: rateValue(stats.hard_bounce_rate),
    softBounces: num(stats.soft_bounces_count),
    softBounceRate: rateValue(stats.soft_bounce_rate),
    forwards: num(stats.forwards_count),
    trackOpens: Boolean(campaign.track_opens),
    previewUrl: campaign.preview_url || campaign.link || null
  };
}

function emptyPayload(error = "") {
  return {
    generatedAt: new Date().toISOString(),
    source: "MailerLite Classic",
    error,
    campaigns: []
  };
}

async function requestJson(path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-MailerLite-ApiKey": API_KEY,
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
    const message = data?.message || data?.error?.message || `MailerLite Classic API respondeu ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function fetchSentCampaigns() {
  const campaigns = [];
  const limit = 100;
  let offset = 0;

  do {
    const data = await requestJson(`/campaigns/sent?limit=${limit}&offset=${offset}&order=desc`);
    const pageCampaigns = Array.isArray(data) ? data : data.data || [];
    campaigns.push(...pageCampaigns);
    if (pageCampaigns.length < limit) break;
    offset += limit;
  } while (offset < 1000);

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
      source: "MailerLite Classic",
      campaigns
    }, null, 2));
    console.log(`Wrote ${campaigns.length} MailerLite campaigns to ${OUT_FILE}`);
  } catch (error) {
    await writeFile(OUT_FILE, JSON.stringify(emptyPayload(error?.message || "Erro desconhecido ao contactar MailerLite."), null, 2));
    console.log(`MailerLite fetch failed: ${error?.message || error}`);
  }
}

await main();
