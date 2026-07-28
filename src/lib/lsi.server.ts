// Server-only helpers for the LSI / competitors flow.
// Do NOT import from client bundles or from *.functions.ts module scope.

import { getApiKey } from "./apiKeys.server";

const TOPVISOR_BASE = "https://api.topvisor.com";
const MIRATEXT_BASE = "https://miratext.ru/api2/call";

export interface LsiGlobalSettings {
  topvisor_project_id: string | null;
  topvisor_region_index: number | null;
  search_engine: string;
  serp_depth: number;
  competitor_count: number;
  project_domain: string;
  blacklist_domains: string[];
}

const DEFAULT_SETTINGS: LsiGlobalSettings = {
  topvisor_project_id: null,
  topvisor_region_index: null,
  search_engine: "google",
  serp_depth: 10,
  competitor_count: 3,
  project_domain: "ggsel.net",
  blacklist_domains: [],
};

export const GLOBAL_FOLDER = "__default";

function normFolder(folder?: string | null): string | null {
  const v = (folder ?? "").trim();
  if (!v || v === GLOBAL_FOLDER) return null;
  return v;
}

function rowToSettings(data: Record<string, unknown>): LsiGlobalSettings {
  return {
    topvisor_project_id: (data.topvisor_project_id as string | null) ?? null,
    topvisor_region_index: (data.topvisor_region_index as number | null) ?? null,
    search_engine: (data.search_engine as string | null) ?? "google",
    serp_depth: (data.serp_depth as number | null) ?? 10,
    competitor_count: (data.competitor_count as number | null) ?? 3,
    project_domain: (data.project_domain as string | null) ?? "ggsel.net",
    blacklist_domains: ((data.blacklist_domains as string[] | null) ?? []),
  };
}

export async function loadSettings(folder?: string | null): Promise<LsiGlobalSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const f = normFolder(folder);

  if (f !== null) {
    const { data } = await supabaseAdmin
      .from("lsi_settings")
      .select("*")
      .eq("folder", f)
      .maybeSingle();
    if (data) return rowToSettings(data as Record<string, unknown>);
  }

  const { data: g } = await supabaseAdmin
    .from("lsi_settings")
    .select("*")
    .is("folder", null)
    .maybeSingle();
  if (g) return rowToSettings(g as Record<string, unknown>);
  return DEFAULT_SETTINGS;
}

export async function saveSettings(
  folder: string | null | undefined,
  patch: Partial<LsiGlobalSettings>,
): Promise<LsiGlobalSettings> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const f = normFolder(folder);
  const current = await loadSettings(f);
  const next = { ...current, ...patch };

  const base = supabaseAdmin.from("lsi_settings").select("id");
  const { data: existing } = f === null
    ? await base.is("folder", null).maybeSingle()
    : await base.eq("folder", f).maybeSingle();

  if (existing?.id) {
    await supabaseAdmin
      .from("lsi_settings")
      .update({ ...next, folder: f, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
  } else {
    await supabaseAdmin.from("lsi_settings").insert({ ...next, folder: f });
  }
  return next;
}

// ---------- Topvisor ----------

async function topvisorFetch(path: string, body: unknown): Promise<unknown> {
  const userId = await getApiKey("TOPVISOR_USER_ID");
  const apiKey = await getApiKey("TOPVISOR_API_KEY");
  if (!userId) throw new Error("Не задан TOPVISOR_USER_ID");
  if (!apiKey) throw new Error("Не задан TOPVISOR_API_KEY");
  const res = await fetch(`${TOPVISOR_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Id": userId,
      Authorization: `bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Topvisor HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export interface TopvisorSerpItem {
  url: string;
  domain: string;
  position: number;
  snippet_title?: string;
  snippet_body?: string;
  keyword?: string;
}

/** Fetches the most recent SERP snapshot for given keywords and flattens results. */
export async function fetchSerpCandidates(params: {
  projectId: string;
  regionIndex?: number | null;
  searchEngine: string;
  depth: number;
  keywords: string[];
}): Promise<{ items: TopvisorSerpItem[]; raw: unknown; snapshotDate?: string }> {
  // Topvisor requires date1/date2 window. Use last 30 days.
  const today = new Date();
  const past = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  // searcher_key: 0 = Google, 1 = Yandex (Topvisor convention)
  const searcherKey = params.searchEngine?.toLowerCase() === "yandex" ? 1 : 0;
  const body: Record<string, unknown> = {
    project_id: params.projectId,
    searcher_key: searcherKey,
    date1: fmt(past),
    date2: fmt(today),
    fields: ["url", "domain", "position", "snippet_title", "snippet_body"],
    filters: [],
    orders: [],
    limit: Math.max(params.depth, 10),
    region_lang: "ru",
  };
  if (params.regionIndex != null) body.region_key = params.regionIndex;
  if (params.keywords.length) body.keywords = params.keywords.slice(0, 30);


  const raw = (await topvisorFetch("/v2/json/get/snapshots_2/history", body)) as {
    result?: {
      snapshots?: Array<{
        date?: string;
        keyword?: string;
        results?: Array<{
          url?: string;
          domain?: string;
          position?: number;
          snippet_title?: string;
          snippet_body?: string;
        }>;
      }>;
    };
    errors?: unknown;
  };
  if (raw.errors) throw new Error(`Topvisor: ${JSON.stringify(raw.errors).slice(0, 300)}`);

  const items: TopvisorSerpItem[] = [];
  let snapshotDate: string | undefined;
  for (const snap of raw.result?.snapshots ?? []) {
    if (snap.date && !snapshotDate) snapshotDate = snap.date;
    for (const r of snap.results ?? []) {
      if (!r.url || !r.domain || !r.position) continue;
      if (r.position > params.depth) continue;
      items.push({
        url: r.url,
        domain: r.domain,
        position: r.position,
        snippet_title: r.snippet_title,
        snippet_body: r.snippet_body,
        keyword: snap.keyword,
      });
    }
  }
  return { items, raw, snapshotDate };
}

const FILE_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|zip|rar|jpe?g|png|gif|webp|svg|mp4|mp3)(\?|$)/i;

export function pickCompetitors(
  items: TopvisorSerpItem[],
  opts: { projectDomain: string; blacklist: string[]; limit: number },
): TopvisorSerpItem[] {
  const bl = new Set(opts.blacklist.map((d) => d.toLowerCase()));
  const projectDomain = opts.projectDomain.toLowerCase().replace(/^www\./, "");

  const filtered = items.filter((i) => {
    const d = i.domain.toLowerCase().replace(/^www\./, "");
    if (d === projectDomain || d.endsWith(`.${projectDomain}`)) return false;
    if (bl.has(d)) return false;
    if (FILE_EXT_RE.test(i.url)) return false;
    return true;
  });

  // aggregate by URL: count how many keywords, avg position
  const perUrl = new Map<
    string,
    {
      url: string;
      domain: string;
      keywordCount: number;
      sumPosition: number;
      snippet_title?: string;
      snippet_body?: string;
    }
  >();
  for (const i of filtered) {
    const prev = perUrl.get(i.url);
    if (prev) {
      prev.keywordCount += 1;
      prev.sumPosition += i.position;
    } else {
      perUrl.set(i.url, {
        url: i.url,
        domain: i.domain,
        keywordCount: 1,
        sumPosition: i.position,
        snippet_title: i.snippet_title,
        snippet_body: i.snippet_body,
      });
    }
  }

  const ranked = Array.from(perUrl.values())
    .map((x) => ({ ...x, avgPosition: x.sumPosition / x.keywordCount }))
    .sort((a, b) => {
      // more keyword coverage first, then better avg position
      if (b.keywordCount !== a.keywordCount) return b.keywordCount - a.keywordCount;
      return a.avgPosition - b.avgPosition;
    });

  // one URL per domain
  const seenDomains = new Set<string>();
  const picked: TopvisorSerpItem[] = [];
  for (const r of ranked) {
    const d = r.domain.toLowerCase().replace(/^www\./, "");
    if (seenDomains.has(d)) continue;
    seenDomains.add(d);
    picked.push({
      url: r.url,
      domain: r.domain,
      position: Math.round(r.avgPosition),
      snippet_title: r.snippet_title,
      snippet_body: r.snippet_body,
    });
    if (picked.length >= opts.limit) break;
  }
  return picked;
}

// ---------- Miratext ----------

export interface MiratextResult {
  status: string;
  hash?: string;
  data?: {
    tz?: {
      keywordsAll?: Array<{ word: string; count?: number; recommended?: number }>;
    };
    repeatWordsAll?: Array<{ word: string; count?: number; siteCount?: number }>;
    repeatWords2All?: Array<{ word: string; count?: number; siteCount?: number }>;
    repeatWords3All?: Array<{ word: string; count?: number; siteCount?: number }>;
    stats?: { length?: number; wordsCount?: number; wateriness?: number; nusea?: number };
  };
  error?: string;
  raw: unknown;
}

async function miratextFetch(action: string, params: Record<string, unknown>): Promise<unknown> {
  const apiKey = await getApiKey("MIRATEXT_API_KEY");
  if (!apiKey) throw new Error("Не задан MIRATEXT_API_KEY");
  const res = await fetch(`${MIRATEXT_BASE}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, ...params }),
  });
  if (!res.ok) throw new Error(`Miratext HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export async function miratextSubmit(urls: string[], currentText?: string): Promise<{ hash: string; raw: unknown }> {
  const params: Record<string, unknown> = {
    check_type: "url",
    shop_type: "normal",
    url: urls,
    options: {
      parse_type: "selenium",
      ignore_predlogs: true,
      ignore_digits: true,
      ignore_alt_title: true,
    },
  };
  if (currentText && currentText.trim()) params.my = currentText;
  const raw = (await miratextFetch("article/seoAnalizText", params)) as { hash?: string; data?: { hash?: string }; error?: string };
  const hash = raw.hash ?? raw.data?.hash;
  if (!hash) throw new Error(`Miratext не вернул hash: ${JSON.stringify(raw).slice(0, 200)}`);
  return { hash, raw };
}

export async function miratextPoll(hash: string): Promise<MiratextResult> {
  const raw = (await miratextFetch("article/seoAnalizText", { hash })) as {
    status?: string;
    data?: MiratextResult["data"];
    error?: string;
  };
  return {
    status: (raw.status ?? "").toString(),
    hash,
    data: raw.data,
    error: raw.error,
    raw,
  };
}

/** Build LSI items rows from a Miratext response. */
export function buildItemsFromMiratext(
  analysisId: string,
  data: MiratextResult["data"] | undefined,
): Array<Record<string, unknown>> {
  if (!data) return [];
  const items: Array<Record<string, unknown>> = [];
  const tzWords = new Set<string>();

  for (const kw of data.tz?.keywordsAll ?? []) {
    if (!kw?.word) continue;
    tzWords.add(kw.word.toLowerCase());
    items.push({
      analysis_id: analysisId,
      type: "word",
      value: kw.word,
      source_field: "tz",
      recommended_count: kw.recommended ?? kw.count ?? null,
      priority: "high",
      status: "required",
    });
  }
  for (const w of data.repeatWordsAll ?? []) {
    if (!w?.word) continue;
    const key = w.word.toLowerCase();
    if (tzWords.has(key)) continue;
    items.push({
      analysis_id: analysisId,
      type: "word",
      value: w.word,
      source_field: "repeatWordsAll",
      recommended_count: w.count ?? null,
      competitor_site_count: w.siteCount ?? null,
      priority: (w.siteCount ?? 0) >= 2 ? "medium" : "low",
      status: "recommended",
    });
  }
  for (const w of data.repeatWords2All ?? []) {
    if (!w?.word) continue;
    items.push({
      analysis_id: analysisId,
      type: "phrase_2",
      value: w.word,
      source_field: "repeatWords2All",
      recommended_count: w.count ?? null,
      competitor_site_count: w.siteCount ?? null,
      priority: (w.siteCount ?? 0) >= 2 ? "medium" : "low",
      status: "recommended",
    });
  }
  for (const w of data.repeatWords3All ?? []) {
    if (!w?.word) continue;
    items.push({
      analysis_id: analysisId,
      type: "phrase_3",
      value: w.word,
      source_field: "repeatWords3All",
      recommended_count: w.count ?? null,
      competitor_site_count: w.siteCount ?? null,
      priority: (w.siteCount ?? 0) >= 2 ? "medium" : "low",
      status: "recommended",
    });
  }
  return items;
}
