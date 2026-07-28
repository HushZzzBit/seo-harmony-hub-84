import { createServerFn } from "@tanstack/react-start";

// -------- Public types (shared with UI) --------

export type LsiItemType = "word" | "phrase_2" | "phrase_3" | "stopword" | "note" | "example_good" | "example_bad" | "block";
export type LsiItemStatus = "required" | "recommended" | "optional" | "excluded";
export type LsiItemPriority = "high" | "medium" | "low";

export interface LsiItem {
  id: string;
  analysis_id: string;
  type: LsiItemType;
  value: string;
  source_field: string | null;
  recommended_count: number | null;
  competitor_site_count: number | null;
  priority: LsiItemPriority | null;
  status: LsiItemStatus;
  is_manual: boolean;
}

export interface LsiCompetitor {
  id: string;
  analysis_id: string;
  url: string;
  domain: string | null;
  position: number | null;
  is_selected: boolean;
  is_excluded: boolean;
  snippet_title: string | null;
  snippet_body: string | null;
}

export type AnalysisStatus =
  | "draft"
  | "collecting_serp"
  | "competitors_found"
  | "analyzing_miratext"
  | "ready_for_review"
  | "approved"
  | "failed";

export interface AnalysisRow {
  id: string;
  group_key: string;
  folder: string | null;
  group_name: string | null;
  target_url: string | null;
  status: AnalysisStatus;
  miratext_hash: string | null;
  error_message: string | null;
  serp_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface VersionRow {
  id: string;
  group_key: string;
  analysis_id: string | null;
  version_number: number;
  status: "draft" | "active" | "archived";
  change_comment: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface ActiveRequirements {
  version: VersionRow | null;
  analysis: AnalysisRow | null;
  items: LsiItem[];
  competitors: LsiCompetitor[];
}

// -------- Settings --------

export const getLsiSettings = createServerFn({ method: "POST" })
  .inputValidator((data: { folder?: string | null } | undefined) => data ?? {})
  .handler(async ({ data }) => {
    const { loadSettings } = await import("./lsi.server");
    return loadSettings(data?.folder ?? null);
  });

export const setLsiSettings = createServerFn({ method: "POST" })
  .inputValidator((data: { folder?: string | null; patch: Record<string, unknown> }) => data)
  .handler(async ({ data }) => {
    const { saveSettings } = await import("./lsi.server");
    return saveSettings(data.folder ?? null, data.patch as Parameters<typeof saveSettings>[1]);
  });

// -------- Analyses / lookups --------

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const listAnalyses = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("text_requirement_analysis")
    .select("*")
    .order("updated_at", { ascending: false });
  return (data ?? []) as unknown as AnalysisRow[];
});

export const getAnalysis = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: a } = await sb.from("text_requirement_analysis").select("*").eq("id", data.id).maybeSingle();
    const { data: comps } = await sb.from("text_requirement_competitor").select("*").eq("analysis_id", data.id);
    const { data: items } = await sb.from("text_requirement_item").select("*").eq("analysis_id", data.id);
    return {
      analysis: (a ?? null) as unknown as AnalysisRow | null,
      competitors: (comps ?? []) as unknown as LsiCompetitor[],
      items: (items ?? []) as unknown as LsiItem[],
    };
  });

/** Public read used by copywriter popup — returns active version for group_key. */
export const getActiveRequirementsForGroup = createServerFn({ method: "POST" })
  .inputValidator((data: { group_key: string }) => data)
  .handler(async ({ data }): Promise<ActiveRequirements> => {
    const sb = await admin();
    const { data: version } = await sb
      .from("text_requirement_version")
      .select("*")
      .eq("group_key", data.group_key)
      .eq("status", "active")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!version) return { version: null, analysis: null, items: [], competitors: [] };
    const v = version as unknown as VersionRow;
    if (!v.analysis_id) return { version: v, analysis: null, items: [], competitors: [] };
    const { data: a } = await sb.from("text_requirement_analysis").select("*").eq("id", v.analysis_id).maybeSingle();
    const { data: items } = await sb
      .from("text_requirement_item")
      .select("*")
      .eq("analysis_id", v.analysis_id)
      .neq("status", "excluded");
    const { data: comps } = await sb
      .from("text_requirement_competitor")
      .select("*")
      .eq("analysis_id", v.analysis_id)
      .eq("is_selected", true);
    return {
      version: v,
      analysis: (a ?? null) as unknown as AnalysisRow | null,
      items: (items ?? []) as unknown as LsiItem[],
      competitors: (comps ?? []) as unknown as LsiCompetitor[],
    };
  });

// -------- Collect competitors from Topvisor --------

export const collectCompetitors = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      group_key: string;
      folder?: string;
      group_name?: string;
      target_url?: string;
      keywords: string[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { loadSettings, fetchSerpCandidates, pickCompetitors } = await import("./lsi.server");
    const s = await loadSettings(data.folder ?? null);
    if (!s.topvisor_project_id) throw new Error("Не указан Topvisor project_id в настройках LSI для стрима");


    const now = new Date().toISOString();
    const { data: inserted, error: insErr } = await sb
      .from("text_requirement_analysis")
      .insert({
        group_key: data.group_key,
        folder: data.folder ?? null,
        group_name: data.group_name ?? null,
        target_url: data.target_url ?? null,
        status: "collecting_serp",
        topvisor_project_id: s.topvisor_project_id,
        topvisor_region_index: s.topvisor_region_index,
        search_engine: s.search_engine,
        serp_depth: s.serp_depth,
        competitor_count: s.competitor_count,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "insert failed");
    const analysisId = inserted.id as string;

    try {
      const { items, raw, snapshotDate, matchedKeywords } = await fetchSerpCandidates({
        projectId: s.topvisor_project_id,
        regionIndex: s.topvisor_region_index,
        searchEngine: s.search_engine,
        depth: s.serp_depth,
        keywords: data.keywords,
        targetUrl: data.target_url ?? null,
      });
      const picked = pickCompetitors(items, {
        projectDomain: s.project_domain,
        blacklist: s.blacklist_domains,
        limit: s.competitor_count,
      });

      if (picked.length) {
        await sb.from("text_requirement_competitor").insert(
          picked.map((p) => ({
            analysis_id: analysisId,
            url: p.url,
            domain: p.domain,
            position: p.position,
            source: "topvisor",
            is_selected: true,
            is_excluded: false,
            snippet_title: p.snippet_title ?? null,
            snippet_body: p.snippet_body ?? null,
          })),
        );
      }

      let msg: string | null = null;
      if (matchedKeywords === 0) {
        msg = "В проекте Topvisor не найдено ключевых фраз по этому URL/названиям. Проверьте project_id и что фразы добавлены в проект.";
      } else if (items.length === 0) {
        const diag = (raw as { diagnostic?: { keywordsInResult?: number; snapshotsPerKeyword?: Array<{ name?: string; snapshotKeys: string[] }> } })?.diagnostic;
        const kwCount = diag?.keywordsInResult ?? 0;
        const withSnaps = diag?.snapshotsPerKeyword?.filter((k) => k.snapshotKeys.length > 0).length ?? 0;
        msg = `Найдено ${matchedKeywords} фраз в проекте. Topvisor вернул ${kwCount} фраз в ответе (ПС: ${s.search_engine}), из них со снимками: ${withSnaps}. Убедитесь что в проекте Topvisor включён сбор снимков выдачи для выбранной ПС (регион Москва, смартфон) и что съём уже прошёл.`;
      } else if (picked.length < s.competitor_count) {
        msg = `Найдено только ${picked.length} конкурентов (из ${s.competitor_count}).`;
      }

      await sb
        .from("text_requirement_analysis")
        .update({
          status: "competitors_found",
          raw_topvisor_response: raw as never,
          serp_date: snapshotDate ?? now,
          updated_at: new Date().toISOString(),
          error_message: msg,
        })
        .eq("id", analysisId);

      return { analysisId, competitorsFound: picked.length, matchedKeywords, serpItems: items.length };

    } catch (e) {
      await sb
        .from("text_requirement_analysis")
        .update({ status: "failed", error_message: (e as Error).message, updated_at: new Date().toISOString() })
        .eq("id", analysisId);
      throw e;
    }
  });

// -------- Run + Poll Miratext --------

export const runMiratext = createServerFn({ method: "POST" })
  .inputValidator((data: { analysisId: string; currentText?: string }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { miratextSubmit } = await import("./lsi.server");
    const { data: comps } = await sb
      .from("text_requirement_competitor")
      .select("url,is_selected,is_excluded")
      .eq("analysis_id", data.analysisId);
    const urls = (comps ?? []).filter((c) => c.is_selected && !c.is_excluded).map((c) => c.url as string);
    if (!urls.length) throw new Error("Нет выбранных конкурентов для анализа");

    try {
      const { hash, raw } = await miratextSubmit(urls, data.currentText);
      await sb
        .from("text_requirement_analysis")
        .update({
          status: "analyzing_miratext",
          miratext_hash: hash,
          raw_miratext_response: raw as never,
          updated_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", data.analysisId);
      return { hash };
    } catch (e) {
      await sb
        .from("text_requirement_analysis")
        .update({ status: "failed", error_message: (e as Error).message, updated_at: new Date().toISOString() })
        .eq("id", data.analysisId);
      throw e;
    }
  });

export const pollMiratext = createServerFn({ method: "POST" })
  .inputValidator((data: { analysisId: string }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: row } = await sb
      .from("text_requirement_analysis")
      .select("id,miratext_hash,group_key")
      .eq("id", data.analysisId)
      .maybeSingle();
    if (!row?.miratext_hash) throw new Error("Miratext hash не найден — запустите анализ заново");

    const { miratextPoll, buildItemsFromMiratext } = await import("./lsi.server");
    const res = await miratextPoll(row.miratext_hash);

    if (res.status === "draft" || res.status === "working") {
      return { status: "working" as const };
    }
    if (res.status === "error" || res.error) {
      await sb
        .from("text_requirement_analysis")
        .update({
          status: "failed",
          error_message: res.error ?? "Miratext error",
          raw_miratext_response: res.raw as never,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.analysisId);
      return { status: "failed" as const, error: res.error };
    }
    if (res.status === "accepted") {
      // wipe previous items so re-runs don't duplicate
      await sb.from("text_requirement_item").delete().eq("analysis_id", data.analysisId).eq("is_manual", false);
      const rows = buildItemsFromMiratext(data.analysisId, res.data);
      if (rows.length) await sb.from("text_requirement_item").insert(rows as never);

      // Create draft version if none exists yet
      const { data: existing } = await sb
        .from("text_requirement_version")
        .select("id,version_number")
        .eq("group_key", row.group_key as string)
        .order("version_number", { ascending: false })
        .limit(1);
      const nextNum = existing && existing[0] ? (existing[0].version_number as number) + 1 : 1;
      const len = res.data?.stats?.length ?? null;
      await sb.from("text_requirement_version").insert({
        group_key: row.group_key as string,
        analysis_id: data.analysisId,
        version_number: nextNum,
        status: "draft",
        recommended_length_min: len ? Math.round(len * 0.9) : null,
        recommended_length_max: len ? Math.round(len * 1.1) : null,
      });

      await sb
        .from("text_requirement_analysis")
        .update({
          status: "ready_for_review",
          raw_miratext_response: res.raw as never,
          updated_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", data.analysisId);
      return { status: "ready" as const, itemsCount: rows.length };
    }
    return { status: "unknown" as const };
  });

// -------- Edit competitors / items --------

export const updateCompetitor = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; patch: Partial<LsiCompetitor> }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    await sb.from("text_requirement_competitor").update(data.patch).eq("id", data.id);
    return { ok: true };
  });

export const addCompetitor = createServerFn({ method: "POST" })
  .inputValidator((data: { analysisId: string; url: string }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    let domain = "";
    try { domain = new URL(data.url).hostname; } catch { /* noop */ }
    const { data: inserted } = await sb
      .from("text_requirement_competitor")
      .insert({ analysis_id: data.analysisId, url: data.url, domain, source: "manual", is_selected: true })
      .select("id")
      .single();
    return { id: inserted?.id };
  });

export const deleteCompetitor = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    await sb.from("text_requirement_competitor").delete().eq("id", data.id);
    return { ok: true };
  });

export const upsertItem = createServerFn({ method: "POST" })
  .inputValidator((data: { id?: string; analysisId: string; patch: Partial<LsiItem> }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    if (data.id) {
      await sb
        .from("text_requirement_item")
        .update({ ...data.patch, updated_at: new Date().toISOString() } as never)
        .eq("id", data.id);
      return { id: data.id };
    }
    const { data: inserted } = await sb
      .from("text_requirement_item")
      .insert({ analysis_id: data.analysisId, is_manual: true, ...data.patch } as never)
      .select("id")
      .single();
    return { id: inserted?.id };
  });

export const deleteItem = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    await sb.from("text_requirement_item").delete().eq("id", data.id);
    return { ok: true };
  });

// -------- Versions --------

export const listVersions = createServerFn({ method: "POST" })
  .inputValidator((data: { group_key: string }) => data)
  .handler(async ({ data }): Promise<VersionRow[]> => {
    const sb = await admin();
    const { data: rows } = await sb
      .from("text_requirement_version")
      .select("*")
      .eq("group_key", data.group_key)
      .order("version_number", { ascending: false });
    return (rows ?? []) as unknown as VersionRow[];
  });

export const approveVersion = createServerFn({ method: "POST" })
  .inputValidator((data: { versionId: string }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: v } = await sb.from("text_requirement_version").select("group_key,analysis_id").eq("id", data.versionId).maybeSingle();
    if (!v) throw new Error("Версия не найдена");
    await sb
      .from("text_requirement_version")
      .update({ status: "archived" })
      .eq("group_key", v.group_key as string)
      .eq("status", "active");
    await sb
      .from("text_requirement_version")
      .update({ status: "active", approved_at: new Date().toISOString() })
      .eq("id", data.versionId);
    if (v.analysis_id) {
      await sb
        .from("text_requirement_analysis")
        .update({ status: "approved", updated_at: new Date().toISOString() })
        .eq("id", v.analysis_id as string);
    }
    return { ok: true };
  });

export const rollbackToVersion = createServerFn({ method: "POST" })
  .inputValidator((data: { versionId: string }) => data)
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: v } = await sb.from("text_requirement_version").select("group_key").eq("id", data.versionId).maybeSingle();
    if (!v) throw new Error("Версия не найдена");
    await sb
      .from("text_requirement_version")
      .update({ status: "archived" })
      .eq("group_key", v.group_key as string)
      .eq("status", "active");
    await sb
      .from("text_requirement_version")
      .update({ status: "active", approved_at: new Date().toISOString() })
      .eq("id", data.versionId);
    return { ok: true };
  });
