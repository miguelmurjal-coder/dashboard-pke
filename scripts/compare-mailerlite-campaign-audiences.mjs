import { mkdir, writeFile } from "node:fs/promises";

const API_KEY = process.env.MAILERLITE_API_KEY || process.env.API_MAILERLITE || process.env.MAILERLITE_API || process.env.API_MAILERLITE_KEY || "";
const BASELINE_CAMPAIGN_ID = process.env.MAILERLITE_BASELINE_CAMPAIGN_ID || "";
const BASELINE_CAMPAIGN_NAME = process.env.MAILERLITE_BASELINE_CAMPAIGN_NAME || "NL MultiChoice 1";
const BASELINE_CAMPAIGN_SUBJECT = process.env.MAILERLITE_BASELINE_CAMPAIGN_SUBJECT || "{$name}, uma pergunta rápida";
const CURRENT_CAMPAIGN_ID = process.env.MAILERLITE_CURRENT_CAMPAIGN_ID || "1278396688";
const CURRENT_CAMPAIGN_NAME = process.env.MAILERLITE_CURRENT_CAMPAIGN_NAME || "NL_LuzPainelFAP_28-07-26";
const CURRENT_CAMPAIGN_SUBJECT = process.env.MAILERLITE_CURRENT_CAMPAIGN_SUBJECT || "";
const OUT_DIR = "exports/mailerlite-audience-comparison";

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

function campaignId(campaign) {
  return clean(campaign.id || campaign.campaign_id || campaign.attributes?.id);
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
    url.searchParams.set("filter[status]", "sent");
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

async function detectCampaignSource() {
  try {
    return await fetchCurrentApiCampaigns();
  } catch (currentError) {
    console.log(`Current API nao respondeu com esta chave: ${currentError.message}`);
    return fetchClassicCampaigns();
  }
}

function findCampaign(campaigns, { id, name, subject }) {
  const expectedId = clean(id);
  if (expectedId) {
    const byId = campaigns.find((campaign) => campaignId(campaign) === expectedId);
    if (byId) return byId;
  }

  const expectedName = lower(name);
  const expectedSubject = lower(subject);
  const matches = campaigns.filter((campaign) => {
    const candidateName = lower(campaignName(campaign));
    const candidateSubject = lower(campaignSubject(campaign));
    const nameMatches = !expectedName || candidateName === expectedName || candidateName.includes(expectedName);
    const subjectMatches = !expectedSubject || candidateSubject === expectedSubject;
    return nameMatches && subjectMatches;
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

function activityType(activity) {
  const attributes = activity.attributes || {};
  return lower(activity.type || activity.event || activity.action || attributes.type || attributes.event || attributes.action || attributes.activity_type || attributes.status);
}

function activityDate(activity) {
  const attributes = activity.attributes || {};
  return attributes.date || attributes.created_at || attributes.occurred_at || attributes.sent_at || activity.date || activity.created_at || "";
}

function normalizeActivity(activity, includedMap = new Map()) {
  const attributes = activity.attributes || {};
  const subscriber = subscriberFromActivity(activity, includedMap);
  const subscriberAttributes = subscriber.attributes || {};
  const fields = subscriberAttributes.fields || subscriber.fields || {};
  const event = activityType(activity);
  const date = activityDate(activity);

  return {
    email: activity.email || attributes.email || subscriber.email || subscriberAttributes.email || "",
    name: activity.name || attributes.name || subscriber.name || subscriberAttributes.name || fields.name || fields.nome || "",
    status: activity.status || attributes.status || subscriber.status || subscriberAttributes.status || "",
    sentAt: attributes.sent_at || activity.sent_at || (event.includes("sent") ? date : ""),
    openedAt: attributes.opened_at || activity.opened_at || (event.includes("open") ? date : ""),
    clickedAt: attributes.clicked_at || activity.clicked_at || (event.includes("click") ? date : ""),
    opensCount: Number(activity.opens_count ?? attributes.opens_count ?? 0) || 0,
    clicksCount: Number(activity.clicks_count ?? attributes.clicks_count ?? 0) || 0,
    bouncedAt: attributes.bounced_at || activity.bounced_at || (event.includes("bounce") ? date : ""),
    unsubscribedAt: attributes.unsubscribed_at || activity.unsubscribed_at || (event.includes("unsub") ? date : "")
  };
}

function mergeRecipientActivity(rows) {
  const map = new Map();

  for (const row of rows) {
    const email = lower(row.email);
    if (!email) continue;
    const current = map.get(email) || {
      email,
      name: "",
      status: "",
      sentAt: "",
      openedAt: "",
      clickedAt: "",
      opensCount: 0,
      clicksCount: 0,
      bouncedAt: "",
      unsubscribedAt: "",
      received: false,
      opened: false,
      clicked: false
    };

    current.name ||= clean(row.name);
    current.status ||= clean(row.status);
    current.sentAt ||= clean(row.sentAt);
    current.openedAt ||= clean(row.openedAt);
    current.clickedAt ||= clean(row.clickedAt);
    current.opensCount += Number(row.opensCount || 0);
    current.clicksCount += Number(row.clicksCount || 0);
    current.bouncedAt ||= clean(row.bouncedAt);
    current.unsubscribedAt ||= clean(row.unsubscribedAt);
    current.received = current.received || Boolean(row.sentAt || !row.bouncedAt);
    current.opened = current.opened || Boolean(row.openedAt) || current.opensCount > 0;
    current.clicked = current.clicked || Boolean(row.clickedAt) || current.clicksCount > 0;

    map.set(email, current);
  }

  return map;
}

async function fetchCurrentRecipientActivity(campaignIdValue, headers) {
  const recipients = [];
  let page = 1;

  do {
    const url = new URL(`https://connect.mailerlite.com/api/campaigns/${campaignIdValue}/reports/subscriber-activity`);
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
  } while (page <= 500);

  return mergeRecipientActivity(recipients);
}

async function fetchClassicRecipientActivity(campaignIdValue, headers) {
  const paths = [
    `/campaigns/${campaignIdValue}/reports/subscriber-activity`,
    `/campaigns/${campaignIdValue}/report/subscriber-activity`,
    `/campaigns/${campaignIdValue}/reports/subscribers`,
    `/campaigns/${campaignIdValue}/report/subscribers`,
    `/campaigns/${campaignIdValue}/recipients`,
    `/campaigns/${campaignIdValue}/subscribers`
  ];

  let lastError = null;
  for (const path of paths) {
    try {
      const data = await requestJson(`https://api.mailerlite.com/api/v2${path}`, headers);
      const rows = Array.isArray(data) ? data : data.data || data.subscribers || data.recipients || [];
      return mergeRecipientActivity(rows.map((row) => normalizeActivity(row)));
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`Nao consegui obter destinatarios na API Classic para a campanha ${campaignIdValue}. Ultimo erro: ${lastError?.message || "desconhecido"}`);
}

async function fetchCampaignAudience(source, campaign) {
  const id = campaignId(campaign);
  if (!id) throw new Error(`Campanha sem ID: ${campaignName(campaign)}`);
  const recipients = source.mode === "current"
    ? await fetchCurrentRecipientActivity(id, source.headers)
    : await fetchClassicRecipientActivity(id, source.headers);
  return { id, recipients };
}

function rowsFromRecipients(recipients) {
  return Array.from(recipients.values()).sort((a, b) => lower(a.email).localeCompare(lower(b.email)));
}

function writeCsv(name, rows) {
  const header = ["email", "name", "status", "received", "opened", "clicked", "opens_count", "clicks_count", "sent_at", "opened_at", "clicked_at", "bounced_at", "unsubscribed_at"];
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
      row.sentAt,
      row.openedAt,
      row.clickedAt,
      row.bouncedAt,
      row.unsubscribedAt
    ].map(csvCell).join(","))
  ].join("\n");
  return writeFile(`${OUT_DIR}/${name}`, `${csv}\n`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  if (!API_KEY) {
    throw new Error("MAILERLITE_API_KEY nao esta configurada.");
  }

  const source = await detectCampaignSource();
  const baselineCampaign = findCampaign(source.campaigns, {
    id: BASELINE_CAMPAIGN_ID,
    name: BASELINE_CAMPAIGN_NAME,
    subject: BASELINE_CAMPAIGN_SUBJECT
  });
  const currentCampaign = findCampaign(source.campaigns, {
    id: CURRENT_CAMPAIGN_ID,
    name: CURRENT_CAMPAIGN_NAME,
    subject: CURRENT_CAMPAIGN_SUBJECT
  });

  if (!baselineCampaign) {
    throw new Error(`Campanha base nao encontrada: "${BASELINE_CAMPAIGN_NAME}" / "${BASELINE_CAMPAIGN_SUBJECT}". Campanhas carregadas: ${source.campaigns.length}.`);
  }
  if (!currentCampaign) {
    throw new Error(`Campanha atual nao encontrada: ID "${CURRENT_CAMPAIGN_ID}" ou nome "${CURRENT_CAMPAIGN_NAME}". Campanhas carregadas: ${source.campaigns.length}.`);
  }

  const baseline = await fetchCampaignAudience(source, baselineCampaign);
  const current = await fetchCampaignAudience(source, currentCampaign);
  const baselineRows = rowsFromRecipients(baseline.recipients);
  const currentRows = rowsFromRecipients(current.recipients);

  const newSubscribers = currentRows.filter((row) => !baseline.recipients.has(lower(row.email)));
  const missingSinceBaseline = baselineRows.filter((row) => !current.recipients.has(lower(row.email)));
  const retained = currentRows.filter((row) => baseline.recipients.has(lower(row.email)));
  const baselineNoOpen = baselineRows.filter((row) => !row.opened);
  const baselineNoClick = baselineRows.filter((row) => !row.clicked);
  const baselineNoOpenNoClick = baselineRows.filter((row) => !row.opened && !row.clicked);
  const baselineNoOpenOrNoClick = baselineRows.filter((row) => !row.opened || !row.clicked);
  const inactiveStillPresent = baselineNoOpenNoClick.filter((row) => current.recipients.has(lower(row.email)));

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

  const summaryRows = [
    ["metric", "value"],
    ["api_mode", source.mode],
    ["baseline_campaign_id", baseline.id],
    ["baseline_campaign_name", campaignName(baselineCampaign)],
    ["baseline_campaign_subject", campaignSubject(baselineCampaign)],
    ["current_campaign_id", current.id],
    ["current_campaign_name", campaignName(currentCampaign)],
    ["current_campaign_subject", campaignSubject(currentCampaign)],
    ["baseline_recipients", baselineRows.length],
    ["current_recipients", currentRows.length],
    ["retained_from_baseline", retained.length],
    ["new_subscribers_current_minus_baseline", newSubscribers.length],
    ["removed_or_not_sent_current", missingSinceBaseline.length],
    ["baseline_no_open", baselineNoOpen.length],
    ["baseline_no_click", baselineNoClick.length],
    ["baseline_no_open_and_no_click", baselineNoOpenNoClick.length],
    ["baseline_no_open_or_no_click", baselineNoOpenOrNoClick.length],
    ["baseline_no_open_no_click_still_present_current", inactiveStillPresent.length]
  ];

  await writeFile(`${OUT_DIR}/summary.csv`, `${summaryRows.map((row) => row.map(csvCell).join(",")).join("\n")}\n`);
  await writeFile(`${OUT_DIR}/summary.json`, JSON.stringify(Object.fromEntries(summaryRows.slice(1)), null, 2));

  console.log(`Base: ${campaignName(baselineCampaign)} | ${campaignSubject(baselineCampaign)} | ${baselineRows.length} destinatarios`);
  console.log(`Atual: ${campaignName(currentCampaign)} | ${campaignSubject(currentCampaign)} | ${currentRows.length} destinatarios`);
  console.log(`Novos subscritores: ${newSubscribers.length}`);
  console.log(`Removidos/nao enviados na atual: ${missingSinceBaseline.length}`);
  console.log(`Antigos sem abertura nem clique: ${baselineNoOpenNoClick.length}`);
  console.log(`Ficheiros gerados em ${OUT_DIR}`);
}

try {
  await main();
} catch (error) {
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(`${OUT_DIR}/error.txt`, `${error?.stack || error?.message || error}\n`);
  throw error;
}
