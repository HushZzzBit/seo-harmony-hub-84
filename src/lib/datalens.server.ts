// Server-only helpers for DataLens. Uses supabaseAdmin (bypasses RLS).
// Rows are pre-matched on the client (see src/lib/datalens-match.ts) and
// streamed in chunks to keep the Worker payload/memory small.
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

export interface MatchedRowExtras {
  matched_url_id: string | null;
  matched_group_id: string | null;
  match_status: string;
}

export type MatchedCategoryRow = CategoryRow & MatchedRowExtras;
export type MatchedStartUrlRow = StartUrlRow & MatchedRowExtras;

export interface CreateImportInput {
  type: DataLensType;
  file_name: string | null;
  rows_total: number;
}

export async function createImport(input: CreateImportInput): Promise<{ importId: string }> {
  const { data, error } = await supabaseAdmin
    .from("datalens_import")
    .insert({
      type: input.type,
      stream: null,
      period_start: null,
      period_end: null,
      file_name: input.file_name,
      comment: null,
      rows_total: input.rows_total,
      rows_matched: 0,
      rows_unmatched: 0,
      status: "importing",
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Failed to create import");
  return { importId: data.id as string };
}

export interface AppendChunkInput {
  importId: string;
  type: DataLensType;
  rows: MatchedCategoryRow[] | MatchedStartUrlRow[];
}

export async function appendRows(input: AppendChunkInput): Promise<{ inserted: number }> {
  if (!input.rows.length) return { inserted: 0 };
  const table = input.type === "categories" ? "datalens_category_metric" : "datalens_start_url_metric";
  const withImport = input.rows.map((r) => ({ ...r, import_id: input.importId }));
  const { error } = await supabaseAdmin.from(table).insert(withImport);
  if (error) throw new Error(error.message);
  return { inserted: withImport.length };
}

export interface FinalizeImportInput {
  importId: string;
  rows_matched: number;
  rows_unmatched: number;
  status?: "ready" | "failed";
  error_message?: string | null;
}

export async function finalizeImport(input: FinalizeImportInput) {
  const status = input.status ?? "ready";
  const patch: {
    rows_matched: number;
    rows_unmatched: number;
    status: string;
    error_log?: { message: string };
  } = {
    rows_matched: input.rows_matched,
    rows_unmatched: input.rows_unmatched,
    status,
  };
  if (status === "failed" && input.error_message) {
    patch.error_log = { message: input.error_message };
  }
  const { error } = await supabaseAdmin.from("datalens_import").update(patch).eq("id", input.importId);
  if (error) throw new Error(error.message);
  return { ok: true };
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
  base_category: string | null;
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

/**
 * PostgREST отдаёт максимум 1000 строк за запрос, поэтому читаем страницами.
 * Опциональный фильтр по группам резко уменьшает объём (дашборд всегда знает,
 * какие группы ему нужны).
 */
const PAGE = 1000;
const MAX_ROWS = 120000;

async function fetchPaged<T>(
  table: "datalens_category_metric" | "datalens_start_url_metric",
  select: string,
  importId: string,
  groups: string[] | null,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = supabaseAdmin.from(table).select(select).eq("import_id", importId);
    if (groups && groups.length) q = q.in("matched_group_id", groups);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function loadLatestMetrics(stream: string | null, groups: string[] | null = null) {
  const catId = await getLatestImportId("categories", stream);
  const urlId = await getLatestImportId("start_url", stream);

  const cats: CategoryMetric[] = catId
    ? await fetchPaged<CategoryMetric>(
        "datalens_category_metric",
        "normalized_url, base_category, category_name, category_url, active_goods, sellers, gmv, matched_url_id, matched_group_id, match_status",
        catId,
        groups,
      )
    : [];
  const urls: StartUrlMetric[] = urlId
    ? await fetchPaged<StartUrlMetric>(
        "datalens_start_url_metric",
        "normalized_url, url, page_name, visits, users, orders, gmv, visit_to_order, bounce_rate, yandex_traffic_percent, google_traffic_percent, matched_url_id, matched_group_id, match_status",
        urlId,
        groups,
      )
    : [];
  return { categoryImportId: catId, startUrlImportId: urlId, categories: cats, startUrls: urls };
}


/* ---------------- Маппинг внешних названий групп (external_group_mapping) --------------- */

export interface GroupMappingRow {
  id: string;
  source: string;
  external_name_raw: string;
  external_name_normalized: string;
  matched_group_id: string | null;
  matched_folder: string | null;
  match_type: string;
  created_at: string;
}

export async function listGroupMappings(): Promise<GroupMappingRow[]> {
  const { data, error } = await supabaseAdmin
    .from("external_group_mapping")
    .select("id, source, external_name_raw, external_name_normalized, matched_group_id, matched_folder, match_type, created_at")
    .order("external_name_normalized", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);
  return (data ?? []) as GroupMappingRow[];
}

export interface UpsertGroupMappingInput {
  external_name_raw: string;
  external_name_normalized: string;
  matched_group_id: string | null;
  matched_folder: string | null;
  match_type?: string;
  source?: string;
}

export async function upsertGroupMapping(input: UpsertGroupMappingInput) {
  const { error } = await supabaseAdmin
    .from("external_group_mapping")
    .upsert(
      {
        source: input.source ?? "datalens_categories",
        external_name_raw: input.external_name_raw,
        external_name_normalized: input.external_name_normalized,
        matched_group_id: input.matched_group_id,
        matched_folder: input.matched_folder,
        match_type: input.match_type ?? "manual",
      },
      { onConflict: "source,external_name_normalized" },
    );
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteGroupMapping(id: string) {
  const { error } = await supabaseAdmin.from("external_group_mapping").delete().eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}
