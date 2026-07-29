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

export async function topvisorFetch(path: string, body: unknown): Promise<unknown> {
  const userId = await getApiKey("TOPVISOR_USER_ID");
  const apiKey = await getApiKey("TOPVISOR_API_KEY");
  if (!userId) throw new Error("Не задан TOPVISOR_USER_ID");
  if (!apiKey) throw new Error("Не задан TOPVISOR_API_KEY");
  const payload = body;

  const res = await fetch(`${TOPVISOR_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Id": userId,
      Authorization: `bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
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

function normDomain(d: string): string {
  return d.toLowerCase().replace(/^www\./, "");
}

/** Fetch project keywords, optionally filtered by target URL and/or names.
 *  Returns [{id, name, url}]. Uses /keywords_2/keywords. */
async function fetchProjectKeywords(params: {
  projectId: string;
  targetUrl?: string | null;
  names?: string[];
}): Promise<Array<{ id: number; name: string; url?: string }>> {
  const body: Record<string, unknown> = {
    project_id: params.projectId,
    fields: ["id", "name", "target"],
  };
  const filters: Array<Record<string, unknown>> = [];
  if (params.names && params.names.length) {
    filters.push({ name: "name", operator: "IN", values: params.names.slice(0, 200) });
  }
  if (filters.length) body.filters = filters;
  const raw = (await topvisorFetch("/v2/json/get/keywords_2/keywords", body)) as {
    result?: Array<{ id: number; name: string; target?: string; url?: string }>;
    errors?: unknown;
  };
  if (raw.errors) throw new Error(`Topvisor keywords: ${JSON.stringify(raw.errors).slice(0, 300)}`);
  let list = (raw.result ?? []).map((k) => ({ id: k.id, name: k.name, url: k.target ?? k.url }));
  if (params.targetUrl) {
    const t = params.targetUrl.toLowerCase().replace(/\/+$/, "");
    const matches = list.filter((k) => (k.url ?? "").toLowerCase().replace(/\/+$/, "") === t);
    if (matches.length) list = matches;
  }
  return list;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

type SnapRec = {
  url?: string;
  domain?: string;
  snippet_title?: string;
  snippet_body?: string;
  position?: number | string;
};

type SnapKw = {
  id?: number;
  name?: string;
  snapshotsData?: Record<string, SnapRec | SnapRec[]>;
};

/** Auto-resolve region_index for the project: Moscow / smartphone / requested searcher. */
async function resolveRegionIndexes(projectId: string, searchEngine: string, fallback?: number | null): Promise<number[]> {
  type Region = {
    index?: number;
    name?: string;
    title?: string;
    country_code?: string;
    country?: string;
    device?: number | string;
    region_device?: number | string;
    lang?: string;
    searcher_key?: number | string;
    searcherKey?: number | string;
    searcher_name?: string;
  };
  const se = (searchEngine || "").toLowerCase();
  const wantKey = se.startsWith("yandex") || se === "y" ? 1 : 0;
  const wantName = wantKey === 1 ? /яндекс|yandex/i : /google|гугл/i;

  let regions: Region[] = [];
  let lastErr: unknown = null;

  const collectRegions = (node: unknown, inherited: { searcherKey?: unknown; searcherName?: unknown } = {}) => {
    if (Array.isArray(node)) {
      for (const item of node) collectRegions(item, inherited);
      return;
    }
    const obj = asRecord(node);
    if (!obj) return;

    const ownSearcherKey = obj.searcher_key ?? obj.searcherKey ?? obj.key;
    const ownSearcherName = obj.searcher_name ?? obj.searcherName ?? obj.name ?? obj.title;
    const nextInherited = {
      searcherKey: ownSearcherKey ?? inherited.searcherKey,
      searcherName: ownSearcherName ?? inherited.searcherName,
    };

    const index = num(obj.index);
    const hasRegionFields = index != null && (
      obj.region_key != null
      || obj.regionKey != null
      || obj.region_device != null
      || obj.device != null
      || obj.lang != null
      || obj.country != null
      || obj.country_code != null
      || obj.regions == null
    );
    if (hasRegionFields) {
      regions.push({
        index,
        name: text(obj.name),
        title: text(obj.title),
        country_code: text(obj.country_code),
        country: text(obj.country),
        device: obj.device as number | string | undefined,
        region_device: obj.region_device as number | string | undefined,
        lang: text(obj.lang),
        searcher_key: (obj.searcher_key ?? inherited.searcherKey) as number | string | undefined,
        searcherKey: obj.searcherKey as number | string | undefined,
        searcher_name: text(obj.searcher_name) ?? text(inherited.searcherName),
      });
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === "regions" || key === "searchers" || key === "searchers_regions" || key === "searchersRegions") {
        collectRegions(value, nextInherited);
      } else if (Array.isArray(value)) {
        const looksNested = value.some((item) => {
          const rec = asRecord(item);
          return rec && (rec.regions != null || rec.searchers != null || rec.index != null);
        });
        if (looksNested) collectRegions(value, nextInherited);
      }
    }
  };

  try {
    const raw = (await topvisorFetch("/v2/json/get/projects_2/projects", {
      fields: ["id", "name", "site"],
      filters: [{ name: "id", operator: "EQUALS", values: [Number(projectId) || projectId] }],
      show_searchers_and_regions: 1,
      limit: 1,
    })) as { result?: unknown; errors?: unknown };
    if (raw.errors) {
      lastErr = raw.errors;
    } else {
      collectRegions(raw.result);
    }
  } catch (e) {
    lastErr = e;
  }

  const ordered: number[] = [];
  const addUnique = (value: number | null | undefined) => {
    if (value == null || ordered.includes(value)) return;
    ordered.push(value);
  };

  if (regions.length) {
    const matchedBySearcher = regions.filter((r) => {
      const k = r.searcher_key ?? r.searcherKey;
      if (k != null) return Number(k) === wantKey;
      const n = `${r.searcher_name ?? ""} ${r.name ?? ""} ${r.title ?? ""}`;
      return n.trim() ? wantName.test(n) : true;
    });
    const pool = matchedBySearcher.length ? matchedBySearcher : regions;
    const scored = pool.map((r) => {
      const label = `${r.name ?? ""} ${r.title ?? ""}`;
      const isMoscow = /москв|moscow/i.test(label);
      const device = num(r.region_device ?? r.device);
      const isMobile = device === 2 || /смартф|phone|mobile/i.test(label);
      const isRu = (r.country_code ?? r.country ?? r.lang ?? "").toString().toUpperCase().includes("RU");
      return { r, score: (isMoscow ? 4 : 0) + (isMobile ? 2 : 0) + (isRu ? 1 : 0) };
    }).sort((a, b) => b.score - a.score);

    for (const item of scored) addUnique(num(item.r.index));
    for (const item of regions) addUnique(num(item.index));
  }

  addUnique(fallback ?? null);

  // If Topvisor does not return project regions, probe common project-local indexes.
  // The snapshots endpoint itself confirms which index actually has saved SERP data.
  if (!regions.length) {
    for (let i = 1; i <= 10; i += 1) addUnique(i);
  }

  if (ordered.length) return ordered;

  throw new Error(`Topvisor regions: не удалось получить список регионов проекта. ${lastErr ? JSON.stringify(lastErr).slice(0, 200) : ""}`);
}

function normalizeSnapshotKeywords(raw: {
  result?: SnapKw[] | { keywords?: SnapKw[] } | Record<string, SnapKw>;
}): SnapKw[] {
  const r = raw.result;
  if (Array.isArray(r)) return r;
  if (r && typeof r === "object") {
    if (Array.isArray((r as { keywords?: SnapKw[] }).keywords)) {
      return (r as { keywords: SnapKw[] }).keywords;
    }
    return Object.values(r as Record<string, SnapKw>);
  }
  return [];
}

function countSnapshotKeys(raw: { result?: SnapKw[] | { keywords?: SnapKw[] } | Record<string, SnapKw> }): number {
  return normalizeSnapshotKeywords(raw).reduce((sum, kw) => sum + Object.keys(kw.snapshotsData ?? {}).length, 0);
}

async function fetchSnapshotsWithRegionFallback(params: {
  projectId: string;
  searchEngine: string;
  fallbackRegionIndex?: number | null;
  baseBody: Omit<Record<string, unknown>, "region_index">;
}): Promise<{
  raw: { result?: SnapKw[] | { keywords?: SnapKw[] } | Record<string, SnapKw>; errors?: unknown };
  body: Record<string, unknown>;
  attempts: Array<{ region_index: number; snapshotKeys?: number; error?: unknown }>;
}> {
  const regionIndexes = await resolveRegionIndexes(params.projectId, params.searchEngine, params.fallbackRegionIndex);
  const attempts: Array<{ region_index: number; snapshotKeys?: number; error?: unknown }> = [];
  let firstOk: {
    raw: { result?: SnapKw[] | { keywords?: SnapKw[] } | Record<string, SnapKw>; errors?: unknown };
    body: Record<string, unknown>;
  } | null = null;
  let lastErr: unknown = null;

  for (const regionIndex of regionIndexes) {
    const body = { ...params.baseBody, region_index: regionIndex };
    try {
      const raw = (await topvisorFetch("/v2/json/get/snapshots_2/history", body)) as {
        result?: SnapKw[] | { keywords?: SnapKw[] } | Record<string, SnapKw>;
        errors?: unknown;
      };
      if (raw.errors) {
        attempts.push({ region_index: regionIndex, error: raw.errors });
        lastErr = raw.errors;
        continue;
      }
      const snapshotKeys = countSnapshotKeys(raw);
      attempts.push({ region_index: regionIndex, snapshotKeys });
      if (!firstOk) firstOk = { raw, body };
      if (snapshotKeys > 0) return { raw, body, attempts };
    } catch (e) {
      attempts.push({ region_index: regionIndex, error: e instanceof Error ? e.message : e });
      lastErr = e;
    }
  }

  if (firstOk) return { ...firstOk, attempts };
  throw new Error(`Topvisor snapshots: ${JSON.stringify(lastErr).slice(0, 300)}`);
}


/** Fetches SERP snapshots for keywords in a Topvisor project.
 *  Uses "Снимки выдачи" (/snapshots_2/history) filtered by keyword IDs. */
export async function fetchSerpCandidates(params: {
  projectId: string;
  regionIndex?: number | null;
  searchEngine: string;
  depth: number;
  keywords: string[];
  targetUrl?: string | null;
}): Promise<{ items: TopvisorSerpItem[]; raw: unknown; snapshotDate?: string; matchedKeywords: number }> {
  // 1) Resolve keyword IDs from the project.
  const projectKeywords = await fetchProjectKeywords({
    projectId: params.projectId,
    targetUrl: params.targetUrl ?? null,
    names: params.keywords,
  });
  if (!projectKeywords.length) {
    return {
      items: [],
      raw: { note: "no project keywords matched", requestedNames: params.keywords.slice(0, 20), targetUrl: params.targetUrl },
      matchedKeywords: 0,
    };
  }
  const keywordIds = projectKeywords.map((k) => k.id);
  const nameById = new Map(projectKeywords.map((k) => [k.id, k.name]));

  // 2) Request last SERP snapshot for those keywords.
  const today = new Date();
  const past = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const baseBody: Record<string, unknown> = {
    project_id: Number(params.projectId) || params.projectId,
    date1: fmt(past),
    date2: fmt(today),
    positions_fields: ["url", "domain", "snippet_title", "snippet_body"],
    count_dates: 1,
    type_range: 7,
    show_exists_dates: 0,
    show_ams: 0,
    filters: [{ name: "id", operator: "IN", values: keywordIds }],
  };
  const { raw, body, attempts } = await fetchSnapshotsWithRegionFallback({
    projectId: params.projectId,
    searchEngine: params.searchEngine,
    fallbackRegionIndex: params.regionIndex,
    baseBody,
  });

  const keywordsResult = normalizeSnapshotKeywords(raw);
  const r = raw.result;

  const items: TopvisorSerpItem[] = [];
  let snapshotDate: string | undefined;

  const pushOne = (
    kwName: string | undefined,
    date: string | undefined,
    positionFromKey: number,
    rec: SnapRec,
  ) => {
    const position = rec.position != null ? Number(rec.position) : positionFromKey;
    if (!rec.url || Number.isNaN(position) || position <= 0) return;
    if (position > params.depth) return;
    if (date && !snapshotDate) snapshotDate = date;
    const resultUrl = rec.url;
    const domain = rec.domain || (() => {
      try {
        return normDomain(new URL(resultUrl).hostname);
      } catch {
        return "";
      }
    })();
    if (!domain) return;
    items.push({
      url: resultUrl,
      domain,
      position,
      snippet_title: rec.snippet_title,
      snippet_body: rec.snippet_body,
      keyword: kwName,
    });
  };

  for (const kw of keywordsResult) {
    const kwName = kw.name ?? (kw.id != null ? nameById.get(kw.id) : undefined);
    const snapshotsData = kw.snapshotsData ?? {};
    for (const [key, val] of Object.entries(snapshotsData)) {
      const parts = key.split(":");
      const date = parts[0];
      const positionFromKey = Number(parts[1]);
      if (Array.isArray(val)) {
        for (const rec of val) pushOne(kwName, date, positionFromKey, rec);
      } else if (val && typeof val === "object") {
        pushOne(kwName, date, positionFromKey, val);
      }
    }
  }

  // Enrich diagnostic in raw for debugging when items are empty.
  const diag = {
    requestBody: body,
    regionAttempts: attempts,
    responseShape: Array.isArray(r) ? "array" : r && typeof r === "object" ? Object.keys(r as object).slice(0, 10) : typeof r,
    keywordsInResult: keywordsResult.length,
    snapshotsPerKeyword: keywordsResult.map((k) => ({
      id: k.id,
      name: k.name,
      snapshotKeys: Object.keys(k.snapshotsData ?? {}).slice(0, 5),
    })),
  };

  return { items, raw: { topvisor: raw, diagnostic: diag }, snapshotDate, matchedKeywords: projectKeywords.length };
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

// Сериализация вложенных объектов в PHP-стиле (http_build_query),
// как это делает эталонный PHP-клиент Миратекст.
function phpBuildQuery(obj: Record<string, unknown>, prefix?: string): string {
  const parts: string[] = [];
  const push = (k: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) {
      v.forEach((item, i) => push(`${k}[${i}]`, item));
    } else if (typeof v === "object") {
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        push(`${k}[${kk}]`, vv);
      }
    } else {
      const val = typeof v === "boolean" ? (v ? "1" : "0") : String(v);
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(val)}`);
    }
  };
  for (const [k, v] of Object.entries(obj)) push(prefix ? `${prefix}[${k}]` : k, v);
  return parts.join("&");
}

async function miratextFetch(action: string, params: Record<string, unknown>): Promise<unknown> {
  const apiKey = await getApiKey("MIRATEXT_API_KEY");
  if (!apiKey) throw new Error("Не задан MIRATEXT_API_KEY");
  // Миратекст ждёт POST с телом form-urlencoded (PHP http_build_query),
  // ключ передаётся как поле api_key на верхнем уровне.
  const body = phpBuildQuery({ api_key: apiKey, ...params });
  const res = await fetch(`${MIRATEXT_BASE}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
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

// ============================================================================
// Data pull: Topvisor project → normalized queries for the app
// ============================================================================

export interface PulledQueryRow {
  phrase: string;
  folder: string;
  group: string;
  url?: string;
  frequency: number;
}

function folderFromUrl(url?: string | null): string {
  if (!url) return "";
  try {
    const u = /^https?:\/\//i.test(url) ? new URL(url) : new URL("https://x" + (url.startsWith("/") ? url : "/" + url));
    const seg = u.pathname.split("/").filter(Boolean)[0];
    return seg ? `/${seg}/` : "/";
  } catch {
    return "";
  }
}

/** Pulls all keywords from every configured Topvisor project (all lsi_settings rows). */
export async function pullAllTopvisorQueries(): Promise<{ rows: PulledQueryRow[]; projects: string[]; errors: string[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: settings } = await supabaseAdmin.from("lsi_settings").select("*");
  const rowsAll: PulledQueryRow[] = [];
  const projects: string[] = [];
  const errors: string[] = [];
  const seenProjects = new Set<string>();

  const settingsRows = (settings ?? []) as Array<Record<string, unknown>>;
  if (!settingsRows.length) {
    errors.push("В таблице lsi_settings нет ни одной строки. Настройте проект(ы) Топвизора в разделе Настройки → API и Ключи.");
  }

  for (const s of settingsRows) {
    const pid = (s.topvisor_project_id as string | null) ?? null;
    if (!pid) continue;
    if (seenProjects.has(pid)) continue;
    seenProjects.add(pid);
    projects.push(pid);
    const folderFallback = (s.folder as string | null) ?? null;
    try {
      const rows = await pullTopvisorProject(pid, folderFallback);
      if (!rows.length) errors.push(`Проект ${pid}: получено 0 фраз (проверьте, что в проекте есть ключевые фразы и указан TOPVISOR_USER_ID/TOPVISOR_API_KEY)`);
      rowsAll.push(...rows);
    } catch (e) {
      errors.push(`Проект ${pid}: ${(e as Error).message}`);
    }
  }

  if (projects.length === 0 && settingsRows.length > 0) {
    errors.push("Ни в одной строке lsi_settings не указан topvisor_project_id.");
  }

  // Deduplicate by phrase+url across projects
  const seen = new Set<string>();
  const dedup: PulledQueryRow[] = [];
  for (const r of rowsAll) {
    const key = `${r.phrase.toLowerCase()}|${(r.url ?? "").toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(r);
  }
  return { rows: dedup, projects, errors };
}

async function fetchRelevantUrlMap(projectId: string, searchEngine: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const pid = Number(projectId) || projectId;
  let regionIndexes: number[] = [];
  try {
    regionIndexes = await resolveRegionIndexes(String(projectId), searchEngine, null);
  } catch {
    return map;
  }
  const today = new Date();
  const past = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  for (const regionIndex of regionIndexes.slice(0, 5)) {
    try {
      const raw = (await topvisorFetch("/v2/json/get/positions_2/history", {
        project_id: pid,
        regions_indexes: [regionIndex],
        date1: fmt(past),
        date2: fmt(today),
        count_dates: 1,
        type_range: 7,
        show_headers: 0,
        show_visitors: 0,
        positions_fields: ["relevant_url", "position"],
      })) as { result?: { keywords?: Array<{ id?: number | string; positionsData?: Record<string, { relevant_url?: string; position?: number | string }> }> }; errors?: unknown };
      if (raw.errors) continue;
      const kws = raw.result?.keywords ?? [];
      for (const kw of kws) {
        if (kw.id == null) continue;
        const id = String(kw.id);
        if (map.has(id)) continue;
        let best: { date: string; url: string } | null = null;
        for (const [k, v] of Object.entries(kw.positionsData ?? {})) {
          const url = v?.relevant_url;
          if (!url) continue;
          const date = k.split(":")[0] ?? "";
          if (!best || date > best.date) best = { date, url };
        }
        if (best?.url) map.set(id, best.url);
      }
    } catch {
      // try next region
    }
  }
  return map;
}

async function pullTopvisorProject(projectId: string, folderFallback: string | null): Promise<PulledQueryRow[]> {
  const pid = Number(projectId) || projectId;

  // Groups map: id → {name, parent_id}. Topvisor "Папка" in экспорте = корневая группа иерархии.
  const groupById = new Map<string, { name: string; parent: string | null }>();
  try {
    const groupsRaw = (await topvisorFetch("/v2/json/get/keywords_2/groups", {
      project_id: pid,
      fields: ["id", "name", "parent_id"],
    })) as { result?: Array<{ id: number | string; name?: string; parent_id?: number | string | null }>; errors?: unknown };
    for (const g of groupsRaw.result ?? []) {
      if (g?.id != null) {
        const parent = g.parent_id != null && String(g.parent_id) !== "0" ? String(g.parent_id) : null;
        groupById.set(String(g.id), { name: g.name ?? "", parent });
      }
    }
  } catch { /* groups optional */ }

  const rootFolderOf = (gid: string | null | undefined): string | null => {
    if (!gid) return null;
    let cur: string | null = String(gid);
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const g = groupById.get(cur);
      if (!g) return null;
      if (!g.parent) return g.name || null;
      cur = g.parent;
    }
    return null;
  };
  const groupNameById = new Map<string, string>();
  for (const [id, g] of groupById.entries()) groupNameById.set(id, g.name);

  // Keywords — try rich fields, fall back if API rejects any.
  type Kw = {
    id?: number | string;
    name?: string;
    target?: string;
    group_id?: number | string;
    group?: number | string;
    volume?: number | string | Array<number | string> | Record<string, unknown>;
    volumes?: unknown;
  };
  const tryFetch = async (fields: string[]): Promise<Kw[]> => {
    const raw = (await topvisorFetch("/v2/json/get/keywords_2/keywords", {
      project_id: pid,
      fields,
    })) as { result?: Kw[]; errors?: unknown };
    if (raw.errors) throw new Error(JSON.stringify(raw.errors).slice(0, 200));
    return raw.result ?? [];
  };

  let list: Kw[] = [];
  const attempts: string[] = [];
  for (const fields of [
    ["id", "name", "target", "group_id", "volume"],
    ["id", "name", "target", "volume"],
    ["id", "name", "target", "group_id"],
    ["id", "name", "target"],
  ]) {
    try { list = await tryFetch(fields); break; }
    catch (e) { attempts.push(`[${fields.join(",")}] ${(e as Error).message}`); }
  }
  if (!list.length && attempts.length === 4) {
    throw new Error(`keywords: ${attempts.join(" | ")}`);
  }

  // Relevant URLs from last SERP snapshot; priority > target when present/different.
  const relevantByKw = new Map<string, string>();
  for (const se of ["google", "yandex"]) {
    try {
      const m = await fetchRelevantUrlMap(projectId, se);
      for (const [k, v] of m.entries()) if (!relevantByKw.has(k)) relevantByKw.set(k, v);
    } catch { /* noop */ }
  }

  const rows: PulledQueryRow[] = [];
  for (const k of list) {
    const phrase = String(k.name ?? "").trim();
    if (!phrase) continue;
    const target = k.target ? String(k.target).trim() : undefined;
    const relevant = k.id != null ? relevantByKw.get(String(k.id)) : undefined;
    // Priority: relevant (if present) > target
    const url = (relevant && relevant.trim()) || target || undefined;
    const groupId = k.group_id ?? k.group;
    const group = groupId != null ? (groupNameById.get(String(groupId)) || "Без группы") : "Без группы";
    const folder = folderFromUrl(url) || folderFallback || "/";

    let freq = 0;
    const v: unknown = k.volume ?? k.volumes;
    if (typeof v === "number") freq = v;
    else if (typeof v === "string") freq = Number(v.replace(/\s/g, "").replace(",", ".")) || 0;
    else if (Array.isArray(v)) {
      for (const it of v) {
        const n = typeof it === "number" ? it : Number(String(it).replace(/\s/g, "")) || 0;
        if (n > freq) freq = n;
      }
    } else if (v && typeof v === "object") {
      for (const it of Object.values(v as Record<string, unknown>)) {
        const n = typeof it === "number" ? it : Number(String(it).replace(/\s/g, "")) || 0;
        if (n > freq) freq = n;
      }
    }

    rows.push({ phrase, folder, group, url, frequency: freq });
  }
  return rows;
}

// ============================================================================
// XmlRiver Wordstat seasonality
// ============================================================================

export interface XmlriverParams {
  phrases: string[];
  device?: "phone" | "desktop" | "tablet";
  regions?: string;   // Yandex geo id, e.g. "225" (Россия), "213" (Москва)
  groupBy?: "day" | "week" | "month";
  dateFrom?: string;  // ISO YYYY-MM-DD
  dateTo?: string;
}

interface XmlriverPoint {
  startTimestamp: number;
  absoluteValue: string;
  value: string;
  text: string;
}

/** Возвращает `phrase → number[12]` (сумма absoluteValue по месяцам). */
export async function pullXmlriverSeasonality(p: XmlriverParams): Promise<{
  map: Record<string, number[]>;
  raw: Record<string, XmlriverPoint[]>;
  errors: string[];
}> {
  const user = (await getApiKey("XMLRIVER_USER")) || "14608";
  const key = (await getApiKey("XMLRIVER_KEY")) || "6bf7bb23bff40a3372aa75c900109215ebea353f";

  const map: Record<string, number[]> = {};
  const raw: Record<string, XmlriverPoint[]> = {};
  const errors: string[] = [];

  const params = new URLSearchParams();
  params.set("user", user);
  params.set("key", key);
  if (p.device) params.set("device", p.device);
  if (p.regions) params.set("regions", p.regions);
  if (p.groupBy) params.set("groupBy", p.groupBy);
  if (p.dateFrom) params.set("dateFrom", p.dateFrom);
  if (p.dateTo) params.set("dateTo", p.dateTo);

  // sequential to avoid overloading the API
  for (const phrase of p.phrases) {
    try {
      const q = new URLSearchParams(params);
      q.set("query", phrase);
      const res = await fetch(`https://xmlriver.com/wordstat/new/json?${q.toString()}`);
      if (!res.ok) { errors.push(`${phrase}: HTTP ${res.status}`); continue; }
      const j = (await res.json()) as {
        graph?: { images?: { timeSeries?: { rawValues?: XmlriverPoint[] } } };
        error?: string;
        code?: number;
      };
      if (j.error) { errors.push(`${phrase}: ${j.error}`); continue; }
      const points = j.graph?.images?.timeSeries?.rawValues ?? [];
      raw[phrase] = points;
      const months = new Array(12).fill(0) as number[];
      for (const pt of points) {
        const d = new Date(pt.startTimestamp);
        const m = d.getUTCMonth();
        const n = Number(String(pt.absoluteValue).replace(/\s/g, "")) || 0;
        months[m] += n;
      }
      map[phrase.toLowerCase().trim()] = months;
    } catch (e) {
      errors.push(`${phrase}: ${(e as Error).message}`);
    }
  }

  return { map, raw, errors };
}
