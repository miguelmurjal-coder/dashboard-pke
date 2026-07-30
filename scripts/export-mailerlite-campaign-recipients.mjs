import { mkdir, writeFile } from "node:fs/promises";

const API_KEY = process.env.MAILERLITE_API_KEY || process.env.API_MAILERLITE || process.env.MAILERLITE_API || process.env.API_MAILERLITE_KEY || "";
const CAMPAIGN_NAME = process.env.MAILERLITE_CAMPAIGN_NAME || "NL MultiChoice 1";
const CAMPAIGN_SUBJECT = process.env.MAILERLITE_CAMPAIGN_SUBJECT || "{$name}, uma pergunta rápida";
const OUT_DIR = "exports";
const OUT_FILE = `${OUT_DIR}/mailerlite-nl-multichoice-1-recipients.csv`;

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

function campaignDate(campaign) {
  const attributes = campaign.attributes || {};
  return campaign.date_send || campaign.sent_at || campaign.finished_at || campaign.send_after || campaign.updated_at || campaign.created_at || campaign.date_created || attributes.sent_at || attributes.created_at || null;
}

function campaignSubject(campaign) {
  const attributes = campaign.attributes || {};
  const firstEmail = Array.isArray(campaign.emails) ? campaign.emails[0] : null;
  return campaign.subject || campaign.email_subject || firstEmail?.subject || attributes.subject || attributes.email_subject || campaign.name || attributes.name || "Newsletter sem assunto";
}

function campaignName(campaign) {
  const attributes = campaign.attributes || {};
  return campaign.name || attributes.name || campaignSubject(campaign);
}

async function requestJson(url, headers) {
  const response = await fetch(url, { headers });
  const body = await response.text();
  let data = null;
  try {
    data = body ? JSON.parse(body) : null;
  } catch {
    data = { message: body };
  }

  if (!response.ok) {
    const message = data?.message || data?.error?.message || data?.errors?.[0]?.detail || `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return data;
}

async function fetchCurrentApiCampaigns() {
  const headers = { Authorization: `Bearer ${API_KEY}`, Accept: "application/json" };
  const campaigns = [];
  let page = 1;

  do {
    const url = new URL("https://connect.mailerlite.com/api/campaigns");
    url.searchParams.set("limit", "100");
    url.searchParams.set("page", String(page));
    const data = await requestJson(url, headers);
    const rows = Array.isArray(data) ? data : data.data || [];
    campaigns.push(...rows);
    const nextPage = data?.meta?.current_page && data?.meta?.last_page && data.meta.current_page < data.meta.last_page;
    if (!nextPage && rows.length < 100) break;
    page += 1;
  } while (page <= 50);

  return { mode: "current", campaigns, headers };
}

async function fetchClassicCampaigns() {
  const headers = { "X-MailerLite-ApiKey": API_KEY, Accept: "application/json" };
  const campaigns = [];
  const limit = 100;
  let offset = 0;

  do {
    const url = `https://api.mailerlite.com/api/v2/campaigns/sent?limit=${limit}&offset=${offset}&order=desc`;
    const data = await requestJson(url, headers);
    const rows = Array.isArray(data) ? data : data.data || [];
    campaigns.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  } while (offset < 5000);

  return { mode: "classic", campaigns, headers };
}

function findCampaign(campaigns) {
  const expectedName = lower(CAMPAIGN_NAME);
  const expectedSubject = lower(CAMPAIGN_SUBJECT);
  const matches = campaigns.filter((campaign) => {
    const name = lower(campaignName(campaign));
    const subject = lower(campaignSubject(campaign));
    return (!expectedName || name === expectedName || name.includes(expectedName)) &&
      (!expectedSubject || subject === expectedSubject);
  });

  return matches.sort((a, b) => new Date(campaignDate(b) || 0) - new Date(campaignDate(a) || 0))[0] || null;
}

function includedSubscribersMap(payload) {
  const map = new Map();
  for (const item of payload?.included || []) {
    if (item?.type === "subscriber" || item?.type === "subscribers") {
      map.set(String(item.id), item);
    }
  }
  return map;
}

function subscriberFromActivity(activity, includedMap) {
  const subscriberRef = activity?.relationships?.subscriber?.data;
  const included = subscriberRef ? includedMap.get(String(subscriberRef.id)) : null;
  return activity.subscriber || included || {};
}

function normalizeActivity(activity, includedMap = new Map()) {
  const attributes = activity.attributes || {};
  const subscriber = subscriberFromActivity(activity, includedMap);
  const subscriberAttributes = subscriber.attributes || {};
  const fields = subscriberAttributes.fields || subscriber.fields || {};

  return {
    email: activity.email || attributes.email || subscriber.email || subscriberAttributes.email || "",
    name: activity.name || attributes.name || subscriber.name || subscriberAttributes.name || fields.name || fields.nome || "",
    status: activity.status || attributes.status || subscriber.status || subscriberAttributes.status || "",
    sentAt: attributes.sent_at || activity.sent_at || activity.date || "",
    openedAt: attributes.opened_at || activity.opened_at || "",
    clickedAt: attributes.clicked_at || activity.clicked_at || "",
    bouncedAt: attributes.bounced_at || activity.bounced_at || "",
    unsubscribedAt: attributes.unsubscribed_at || activity.unsubscribed_at || ""
  };
}

async function fetchCurrentRecipientActivity(campaignId, headers) {
  const recipients = [];
  let page = 1;

  do {
    const url = new URL(`https://connect.mailerlite.com/api/campaigns/${campaignId}/reports/subscriber-activity`);
    url.searchParams.set("include", "subscriber");
    url.searchParams.set("limit", "100");
    url.searchParams.set("page", String(page));
    const data = await requestJson(url, headers);
    const includedMap = includedSubscribersMap(data);
    const rows = Array.isArray(data) ? data : data.data || [];
    recipients.push(...rows.map((row) => normalizeActivity(row, includedMap)));
    const nextPage = data?.meta?.current_page && data?.meta?.last_page && data.meta.current_page < data.meta.last_page;
    if (!nextPage && rows.length < 100) break;
    page += 1;
  } while (page <= 100);

  return recipients;
}

async function fetchClassicRecipientActivity(campaignId, headers) {
  const paths = [
    `/campaigns/${campaignId}/reports/subscriber-activity`,
    `/campaigns/${campaignId}/report/subscriber-activity`,
    `/campaigns/${campaignId}/reports/subscribers`,
    `/campaigns/${campaignId}/report/subscribers`,
    `/campaigns/${campaignId}/recipients`,
    `/campaigns/${campaignId}/subscribers`
  ];

  let lastError = null;
  for (const path of paths) {
    try {
      const data = await requestJson(`https://api.mailerlite.com/api/v2${path}`, headers);
      const rows = Array.isArray(data) ? data : data.data || data.subscribers || data.recipients || [];
      return rows.map((row) => normalizeActivity(row));
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Nao consegui obter destinatarios na API Classic para a campanha ${campaignId}. Ultimo erro: ${lastError?.message || "desconhecido"}`);
}

async function detectCampaignSource() {
  try {
    return await fetchCurrentApiCampaigns();
  } catch (currentError) {
    console.log(`Current API nao respondeu com esta chave: ${currentError.message}`);
    return fetchClassicCampaigns();
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  if (!API_KEY) {
    throw new Error("MAILERLITE_API_KEY nao esta configurada.");
  }

  const source = await detectCampaignSource();
  const campaign = findCampaign(source.campaigns);
  if (!campaign) {
    throw new Error(`Campanha nao encontrada. Procurei nome "${CAMPAIGN_NAME}" e subject "${CAMPAIGN_SUBJECT}". Campanhas carregadas: ${source.campaigns.length}.`);
  }

  const campaignId = campaign.id;
  const recipients = source.mode === "current"
    ? await fetchCurrentRecipientActivity(campaignId, source.headers)
    : await fetchClassicRecipientActivity(campaignId, source.headers);

  const unique = new Map();
  for (const recipient of recipients) {
    const key = lower(recipient.email) || JSON.stringify(recipient);
    if (!unique.has(key)) unique.set(key, recipient);
  }

  const rows = Array.from(unique.values()).sort((a, b) => lower(a.email).localeCompare(lower(b.email)));
  const csv = [
    ["email", "name", "status", "sent_at", "opened_at", "clicked_at", "bounced_at", "unsubscribed_at"].join(","),
    ...rows.map((row) => [row.email, row.name, row.status, row.sentAt, row.openedAt, row.clickedAt, row.bouncedAt, row.unsubscribedAt].map(csvCell).join(","))
  ].join("\n");

  await writeFile(OUT_FILE, `${csv}\n`);
  console.log(`Campanha: ${campaignName(campaign)} | Subject: ${campaignSubject(campaign)} | ID: ${campaignId}`);
  console.log(`Modo API: ${source.mode}`);
  console.log(`Destinatarios exportados: ${rows.length}`);
  console.log(`Ficheiro: ${OUT_FILE}`);
}

await main();
