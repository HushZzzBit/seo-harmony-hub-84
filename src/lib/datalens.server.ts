// Server-only helpers for DataLens. Uses supabaseAdmin (bypasses RLS).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { CategoryRow, DataLensType, StartUrlRow } from "./datalens";

export interface ImportRow {
  id: string;
  type: DataLensType;
  stream: string | null;
  period_start: string | null;
  period_end: string | null;
  uploaded_at: string;
  file_name: string | null;
  comment: string | null;
  rows_total: number;
  rows_matched: number;
  rows_unmatched: number;
  status: string;
}

export type UrlMatchSource = "relevant_g" | "relevant_y" | "target";

export interface UrlMatchInput {
  url: string;
  normalized: string | null;
  folder: string | null;
  group: string | null;
  source: UrlMatchSource;
}

export interface NameHint {
  token: string; // lowercase slug token (>=3 chars)
  folder: string | null;
  group: string | null;
}

export type SePriority = "any" | "google" | "yandex";

interface MatchIndex {
  byNormRelevantG: Map<string, UrlMatchInput[]>;
  byNormRelevantY: Map<string, UrlMatchInput[]>;
  byNormTarget: Map<string, UrlMatchInput[]>;
  bySlug: Map<string, UrlMatchInput[]>;
  hints: NameHint[];
}

function buildMatchIndex(seoUrls: UrlMatchInput[], hints: NameHint[]): MatchIndex {
  const byNormRelevantG = new Map<string, UrlMatchInput[]>();
  const byNormRelevantY = new Map<string, UrlMatchInput[]>();
  const byNormTarget = new Map<string, UrlMatchInput[]>();
  const bySlug = new Map<string, UrlMatchInput[]>();
  const push = (m: Map<string, UrlMatchInput[]>, k: string, u: UrlMatchInput) => {
    const a = m.get(k) ?? []; a.push(u); m.set(k, a);
  };
  for (const u of seoUrls) {
    if (u.normalized) {
      if (u.source === "relevant_g") push(byNormRelevantG, u.normalized, u);
      else if (u.source === "relevant_y") push(byNormRelevantY, u.normalized, u);
      else if (u.source === "target") push(byNormTarget, u.normalized, u);
    }
    const slug = (u.normalized ?? "").split("/").filter(Boolean).pop() ?? "";
    if (slug) push(bySlug, slug, u);
  }
  return { byNormRelevantG, byNormRelevantY, byNormTarget, bySlug, hints };
}

function tokenize(norm: string): string[] {
  return norm.split(/[/\-_.]/).map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
}

function pickFromEntries(entries: UrlMatchInput[], status: string) {
  const uniqueGroups = new Set(entries.map((u) => `${u.folder}::${u.group}`));
  return {
    matched_url_id: entries[0].url,
    matched_group_id: entries[0].group,
    match_status: uniqueGroups.size > 1 ? "group_conflict" : status,
  };
}

function matchOne(
  norm: string | null,
  idx: MatchIndex,
  sePriority: SePriority,
): { matched_url_id: string | null; matched_group_id: string | null; match_status: string } {
  if (!norm) return { matched_url_id: null, matched_group_id: null, match_status: "unmatched" };

  // 1. Relevant URL (SE priority)
  const rgFirst = sePriority !== "yandex";
  const relOrder: Array<[Map<string, UrlMatchInput[]>, string]> = rgFirst
    ? [[idx.byNormRelevantG, "matched_by_relevant_g"], [idx.byNormRelevantY, "matched_by_relevant_y"]]
    : [[idx.byNormRelevantY, "matched_by_relevant_y"], [idx.byNormRelevantG, "matched_by_relevant_g"]];
  for (const [map, status] of relOrder) {
    const hit = map.get(norm);
    if (hit && hit.length) return pickFromEntries(hit, status);
  }

  // 2. Target URL
  const tgt = idx.byNormTarget.get(norm);
  if (tgt && tgt.length) return pickFromEntries(tgt, "matched_by_target");

  // 3. Name fallback: token from folder/group present as a path segment
  if (idx.hints.length) {
    const tokens = new Set(tokenize(norm));
    const hits = idx.hints.filter((h) => tokens.has(h.token));
    if (hits.length) {
      const uniqueGroups = new Set(hits.map((h) => `${h.folder}::${h.group}`));
      return {
        matched_url_id: null,
        matched_group_id: hits[0].group,
        match_status: uniqueGroups.size > 1 ? "group_conflict" : "matched_by_name",
      };
    }
  }

  // 4. Slug fallback (any source)
  const slug = norm.split("/").filter(Boolean).pop() ?? "";
  if (slug) {
    const bySlug = idx.bySlug.get(slug);
    if (bySlug && bySlug.length === 1) {
      return { matched_url_id: bySlug[0].url, matched_group_id: bySlug[0].group, match_status: "matched_by_slug" };
    }
    if (bySlug && bySlug.length > 1) {
      return { matched_url_id: null, matched_group_id: null, match_status: "ambiguous_slug" };
    }
  }
  return { matched_url_id: null, matched_group_id: null, match_status: "unmatched" };
}

export interface SaveImportInput {
  type: DataLensType;
  stream: string | null;
  period_start: string | null;
  period_end: string | null;
  file_name: string | null;
  comment: string | null;
  seo_urls: UrlMatchInput[];
  name_hints?: NameHint[];
  se_priority?: SePriority;
  categories?: CategoryRow[];
  start_urls?: StartUrlRow[];
}

export async function saveImport(input: SaveImportInput) {
  const rows_total =
    input.type === "categories"
      ? input.categories?.length ?? 0
      : input.start_urls?.length ?? 0;

  const idx = buildMatchIndex(input.seo_urls, input.name_hints ?? []);
  const sePriority: SePriority = input.se_priority ?? "any";
  let matched = 0;
  let unmatched = 0;

  // Create the import row first
  const { data: created, error: createErr } = await supabaseAdmin
    .from("datalens_import")
    .insert({
      type: input.type,
      stream: input.stream,
      period_start: input.period_start,
      period_end: input.period_end,
      file_name: input.file_name,
      comment: input.comment,
      rows_total,
      rows_matched: 0,
      rows_unmatched: 0,
      status: "importing",
    })
    .select("id")
    .single();
  if (createErr || !created) throw new Error(createErr?.message ?? "Failed to create import");
  const importId = created.id as string;

  try {
    if (input.type === "categories" && input.categories?.length) {
      const rows = input.categories.map((r) => {
        const m = matchOne(r.normalized_url, idx, sePriority);
        if (m.match_status === "unmatched" || m.match_status === "ambiguous_slug") unmatched++;
        else matched++;
        return { import_id: importId, ...r, ...m };
      });
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabaseAdmin.from("datalens_category_metric").insert(rows.slice(i, i + CHUNK));
        if (error) throw new Error(error.message);
      }
    }
    if (input.type === "start_url" && input.start_urls?.length) {
      const rows = input.start_urls.map((r) => {
        const m = matchOne(r.normalized_url, idx, sePriority);
        if (m.match_status === "unmatched" || m.match_status === "ambiguous_slug") unmatched++;
        else matched++;
        return { import_id: importId, ...r, ...m };
      });
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabaseAdmin.from("datalens_start_url_metric").insert(rows.slice(i, i + CHUNK));
        if (error) throw new Error(error.message);
      }
    }
    await supabaseAdmin
      .from("datalens_import")
      .update({ rows_matched: matched, rows_unmatched: unmatched, status: "ready" })
      .eq("id", importId);
    return { importId, rows_total, rows_matched: matched, rows_unmatched: unmatched };
  } catch (e) {
    await supabaseAdmin
      .from("datalens_import")
      .update({ status: "failed", error_log: { message: e instanceof Error ? e.message : String(e) } })
      .eq("id", importId);
    throw e;
  }
}

export async function listImports(): Promise<ImportRow[]> {
  const { data, error } = await supabaseAdmin
    .from("datalens_import")
    .select("id, type, stream, period_start, period_end, uploaded_at, file_name, comment, rows_total, rows_matched, rows_unmatched, status")
    .order("uploaded_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as ImportRow[];
}

export async function deleteImport(id: string) {
  const { error } = await supabaseAdmin.from("datalens_import").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Latest ready import per type (stream is ignored — matching is by folder/group of matched URL). */
async function getLatestImportId(type: DataLensType, _stream: string | null): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("datalens_import")
    .select("id")
    .eq("type", type)
    .eq("status", "ready")
    .order("uploaded_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.id ?? null;
}


export interface CategoryMetric {
  normalized_url: string | null;
  category_name: string | null;
  category_url: string | null;
  active_goods: number | null;
  sellers: number | null;
  gmv: number | null;
  matched_url_id: string | null;
  matched_group_id: string | null;
  match_status: string;
}
export interface StartUrlMetric {
  normalized_url: string | null;
  url: string | null;
  page_name: string | null;
  visits: number | null;
  users: number | null;
  orders: number | null;
  gmv: number | null;
  visit_to_order: number | null;
  bounce_rate: number | null;
  yandex_traffic_percent: number | null;
  google_traffic_percent: number | null;
  matched_url_id: string | null;
  matched_group_id: string | null;
  match_status: string;
}

export async function loadLatestMetrics(stream: string | null) {
  const catId = await getLatestImportId("categories", stream);
  const urlId = await getLatestImportId("start_url", stream);

  const cats: CategoryMetric[] = [];
  const urls: StartUrlMetric[] = [];

  if (catId) {
    const { data, error } = await supabaseAdmin
      .from("datalens_category_metric")
      .select("normalized_url, category_name, category_url, active_goods, sellers, gmv, matched_url_id, matched_group_id, match_status")
      .eq("import_id", catId)
      .limit(20000);
    if (error) throw new Error(error.message);
    cats.push(...((data ?? []) as CategoryMetric[]));
  }
  if (urlId) {
    const { data, error } = await supabaseAdmin
      .from("datalens_start_url_metric")
      .select("normalized_url, url, page_name, visits, users, orders, gmv, visit_to_order, bounce_rate, yandex_traffic_percent, google_traffic_percent, matched_url_id, matched_group_id, match_status")
      .eq("import_id", urlId)
      .limit(20000);
    if (error) throw new Error(error.message);
    urls.push(...((data ?? []) as StartUrlMetric[]));
  }
  return { categoryImportId: catId, startUrlImportId: urlId, categories: cats, startUrls: urls };
}
