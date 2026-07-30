import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDataLensMetrics } from "@/lib/datalens.functions";
import { useStore } from "@/lib/store";
import { normalizeUrl } from "@/lib/datalens";
import type { Query } from "@/lib/types";

interface CategoryMetric {
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
interface StartUrlMetric {
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

const sum = (arr: (number | null | undefined)[]) =>
  arr.reduce((a: number, b) => a + (typeof b === "number" && Number.isFinite(b) ? b : 0), 0);

const STATUS_LABEL: Record<string, string> = {
  matched_by_relevant_g: "По релевантной (Google)",
  matched_by_relevant_y: "По релевантной (Яндекс)",
  matched_by_target: "По целевой ссылке",
  matched_by_base_category: "По Base category",
  matched_by_alias: "По alias Base category",
  matched_by_manual: "Ручная привязка",
  unmatched_base_category: "Base category не сопоставлена",
  matched_by_name: "По названию (fallback)",
  matched_by_slug: "По slug",
  group_conflict: "Конфликт групп",
  ambiguous_slug: "Неоднозначный slug",
  unmatched: "Не сопоставлено",
};

function MatchingSummary({
  rows,
}: {
  rows: Array<{ match_status: string; matched_group_id: string | null; normalized_url: string | null; gmv?: number | null }>;
}) {
  const byStatus = new Map<string, number>();
  const byOwner = new Map<string, { count: number; gmv: number }>();
  const conflicts: Array<{ url: string; group: string | null }> = [];
  for (const r of rows) {
    byStatus.set(r.match_status, (byStatus.get(r.match_status) ?? 0) + 1);
    const owner = r.matched_group_id ?? "—";
    const prev = byOwner.get(owner) ?? { count: 0, gmv: 0 };
    prev.count += 1;
    prev.gmv += Number.isFinite(r.gmv ?? NaN) ? Number(r.gmv) : 0;
    byOwner.set(owner, prev);
    if (r.match_status === "group_conflict" || r.match_status === "ambiguous_slug") {
      conflicts.push({ url: r.normalized_url ?? "—", group: r.matched_group_id });
    }
  }
  const sortedOwners = Array.from(byOwner.entries()).sort((a, b) => b[1].gmv - a[1].gmv).slice(0, 8);
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card>
        <CardHeader className="p-3 pb-1"><CardTitle className="text-xs">URL матчинг</CardTitle></CardHeader>
        <CardContent className="p-3 pt-1 space-y-1 text-xs">
          {Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1]).map(([s, n]) => (
            <div key={s} className="flex justify-between gap-2">
              <span className={s.startsWith("matched") ? "" : "text-destructive"}>{STATUS_LABEL[s] ?? s}</span>
              <span className="tabular-nums">{n}</span>
            </div>
          ))}
          {byStatus.size === 0 && <div className="text-muted-foreground">Нет данных</div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="p-3 pb-1"><CardTitle className="text-xs">Owner Group (TOP-8 по GMV)</CardTitle></CardHeader>
        <CardContent className="p-3 pt-1 space-y-1 text-xs">
          {sortedOwners.map(([g, v]) => (
            <div key={g} className="flex justify-between gap-2">
              <span className="truncate">{g}</span>
              <span className="tabular-nums text-muted-foreground">{v.count} · {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(v.gmv)}</span>
            </div>
          ))}
          {sortedOwners.length === 0 && <div className="text-muted-foreground">Нет данных</div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="p-3 pb-1"><CardTitle className="text-xs">Конфликты ({conflicts.length})</CardTitle></CardHeader>
        <CardContent className="p-3 pt-1 space-y-1 text-xs max-h-40 overflow-auto">
          {conflicts.slice(0, 30).map((c, i) => (
            <div key={i} className="truncate" title={c.url}>
              <span className="text-destructive">•</span> {c.url}{" "}
              <span className="text-muted-foreground">{c.group ?? ""}</span>
            </div>
          ))}
          {conflicts.length === 0 && <div className="text-muted-foreground">Конфликтов нет</div>}
        </CardContent>
      </Card>
    </div>
  );
}

export function useDataLens(stream: string | null, groups?: string[] | null) {
  const fn = useServerFn(getDataLensMetrics);
  const [data, setData] = useState<{ categories: CategoryMetric[]; startUrls: StartUrlMetric[] }>({
    categories: [],
    startUrls: [],
  });
  const [loading, setLoading] = useState(false);
  const groupsKey = groups && groups.length ? groups.slice().sort().join("|") : "";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn({ data: { stream, groups: groupsKey ? groupsKey.split("|") : null } })
      .then((res) => {
        if (!cancelled) setData({ categories: res.categories, startUrls: res.startUrls });
      })
      .catch(() => {
        if (!cancelled) setData({ categories: [], startUrls: [] });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, groupsKey]);

  return { ...data, loading };
}

function useFolderGroups(stream: string | null): Set<string> | null {
  const queries = useStore((s) => s.queries);
  return useMemo(() => {
    if (!stream) return null;
    const s = new Set<string>();
    for (const q of queries) if (q.folder === stream && q.group) s.add(q.group);
    return s;
  }, [queries, stream]);
}

/**
 * Единый реестр владения URL, поддерживаемый useOwnershipSync().
 * DataLens → Topvisor group; при отсутствии — legacy matched_group_id.
 */
function useUrlOwnershipMap(): Map<string, { folder: string | null; group: string | null }> {
  const ownership = useStore((s) => s.ownership);
  return useMemo(() => {
    const m = new Map<string, { folder: string | null; group: string | null }>();
    for (const [k, v] of Object.entries(ownership ?? {})) m.set(k, v);
    return m;
  }, [ownership]);
}

/** Множество нормализованных URL, присутствующих в Topvisor (для intersect). */
function useTopvisorUrlSet(): Set<string> {
  const queries = useStore((s) => s.queries);
  return useMemo(() => {
    const s = new Set<string>();
    const add = (u: string | null | undefined) => {
      const n = normalizeUrl(u ?? null);
      if (n) s.add(n);
    };
    for (const q of queries) {
      add(q.url); add(q.targetUrl); add(q.relevantGoogle); add(q.relevantYandex);
    }
    return s;
  }, [queries]);
}

function filterByFolder<T extends { matched_group_id: string | null; normalized_url: string | null; match_status?: string }>(
  rows: T[],
  folderGroups: Set<string> | null,
  group: string | null | undefined,
  ownership: Map<string, { folder: string | null; group: string | null }>,
): T[] {
  // Единый источник владения: сначала ownership registry, затем legacy fallback.
  const AUTHORITATIVE = new Set(["matched_by_base_category", "matched_by_alias", "matched_by_manual"]);
  const effectiveGroup = (r: T): string | null => {
    // Base category — основной ключ группы для DataLens Categories.
    if (r.match_status && AUTHORITATIVE.has(r.match_status) && r.matched_group_id) return r.matched_group_id;
    const own = r.normalized_url ? ownership.get(r.normalized_url) : undefined;
    if (own?.group) return own.group;
    const trust =
      r.match_status &&
      r.match_status !== "matched_by_name" &&
      r.match_status !== "matched_by_slug" &&
      r.match_status !== "ambiguous_slug" &&
      r.match_status !== "unmatched" &&
      r.match_status !== "unmatched_base_category";
    return trust ? r.matched_group_id : null;
  };
  if (group) return rows.filter((r) => effectiveGroup(r) === group);
  if (folderGroups) return rows.filter((r) => {
    const g = effectiveGroup(r);
    return g != null && folderGroups.has(g);
  });
  return rows;
}



export function BusinessMetricsTab({ stream, group }: { stream: string | null; group?: string | null }) {
  const folderGroups = useFolderGroups(stream);
  const requestGroups = useMemo(
    () => (group ? [group] : folderGroups ? Array.from(folderGroups) : null),
    [group, folderGroups],
  );
  const { categories: allCategories, startUrls: allStartUrls, loading } = useDataLens(null, requestGroups);
  const ownership = useUrlOwnershipMap();
  const categories = useMemo(() => filterByFolder(allCategories, folderGroups, group, ownership), [allCategories, folderGroups, group, ownership]);
  const startUrls = useMemo(() => filterByFolder(allStartUrls, folderGroups, group, ownership), [allStartUrls, folderGroups, group, ownership]);
  const metaEdits = useStore((s) => s.metaEdits);
  const texts = useStore((s) => s.texts);
  const urls = useStore((s) => s.urls);

  const catGmv = sum(categories.map((c) => c.gmv));
  const urlGmv = sum(startUrls.map((u) => u.gmv));
  const totalGoods = sum(categories.map((c) => c.active_goods));
  const totalSellers = sum(categories.map((c) => c.sellers));
  const totalVisits = sum(startUrls.map((u) => u.visits));
  const totalUsers = sum(startUrls.map((u) => u.users));
  const totalOrders = sum(startUrls.map((u) => u.orders));
  const conv = totalVisits > 0 ? (totalOrders / totalVisits) * 100 : 0;

  const gmvUnworked = sum(
    startUrls
      .filter((u) => {
        const url = u.matched_url_id;
        const metaDone = url ? metaEdits[url]?.status === "done" : false;
        const textDone = url ? texts[url]?.status === "done" : false;
        return !(metaDone && textDone);
      })
      .map((u) => u.gmv),
  );
  const gmvNoMeta = sum(
    startUrls
      .filter((u) => {
        const url = u.matched_url_id;
        return !url || !(metaEdits[url]?.title || urls[url]?.title);
      })
      .map((u) => u.gmv),
  );
  const gmvNoText = sum(
    startUrls
      .filter((u) => {
        const url = u.matched_url_id;
        return !url || !(urls[url]?.hasText || texts[url]?.text);
      })
      .map((u) => u.gmv),
  );

  if (loading) {
    return <div className="text-sm text-muted-foreground">Загружаем данные DataLens…</div>;
  }
  if (!allCategories.length && !allStartUrls.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Нет данных DataLens. Загрузите файлы в разделе Импорт/Экспорт.
        </CardContent>
      </Card>
    );
  }
  if (!categories.length && !startUrls.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          В последнем импорте DataLens нет строк, сматченных к стриму «{stream}». Проверьте маппинг URL в Topvisor или загрузите свежий выгруз.
        </CardContent>
      </Card>
    );
  }


  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="GMV суммарный" value={fmtNum(catGmv + urlGmv)} />
        <Kpi label="GMV (Categories)" value={fmtNum(catGmv)} />
        <Kpi label="GMV (Start URL)" value={fmtNum(urlGmv)} />
        <Kpi label="Товары" value={fmtNum(totalGoods)} />
        <Kpi label="Селлеры" value={fmtNum(totalSellers)} />
        <Kpi label="Визиты" value={fmtNum(totalVisits)} />
        <Kpi label="Пользователи" value={fmtNum(totalUsers)} />
        <Kpi label="Заказы" value={fmtNum(totalOrders)} />
        <Kpi label="Конверсия Visit→Order" value={`${conv.toFixed(2)}%`} />
        <Kpi label="GMV непроработанных URL" value={fmtNum(gmvUnworked)} tone="destructive" />
        <Kpi label="GMV без мета" value={fmtNum(gmvNoMeta)} tone="destructive" />
        <Kpi label="GMV без текста" value={fmtNum(gmvNoText)} tone="destructive" />
      </div>
      <MatchingSummary
        rows={[
          ...startUrls.map((u) => ({ match_status: u.match_status, matched_group_id: u.matched_group_id, normalized_url: u.normalized_url, gmv: u.gmv })),
          ...categories.map((c) => ({ match_status: c.match_status, matched_group_id: c.matched_group_id, normalized_url: c.normalized_url, gmv: c.gmv })),
        ]}
      />
    </div>
  );
}

export function UrlAnalyticsTab({ stream, group }: { stream: string | null; group?: string | null }) {
  const folderGroups = useFolderGroups(stream);
  const requestGroups = useMemo(
    () => (group ? [group] : folderGroups ? Array.from(folderGroups) : null),
    [group, folderGroups],
  );
  const { startUrls: allStartUrls, categories: allCategories, loading } = useDataLens(null, requestGroups);
  const ownership = useUrlOwnershipMap();
  const topvisorUrls = useTopvisorUrlSet();
  const startUrls = useMemo(() => filterByFolder(allStartUrls, folderGroups, group, ownership), [allStartUrls, folderGroups, group, ownership]);
  const categories = useMemo(() => filterByFolder(allCategories, folderGroups, group, ownership), [allCategories, folderGroups, group, ownership]);
  const queries = useStore((s) => s.queries);
  const urls = useStore((s) => s.urls);
  const metaEdits = useStore((s) => s.metaEdits);
  const texts = useStore((s) => s.texts);


  const [sortBy, setSortBy] = useState<"gmv" | "visits" | "orders" | "top10g">("gmv");
  const [onlyNoMeta, setOnlyNoMeta] = useState(false);
  const [onlyNoText, setOnlyNoText] = useState(false);
  const [outsideTop10, setOutsideTop10] = useState(false);

  // Aggregate: one row per normalized URL, merging Start URL + Categories.
  // Categories match by their own Category URL, so category-only rows are shown too.
  const rows = useMemo(() => {
    const catByUrl = new Map<string, CategoryMetric>();
    for (const c of categories) if (c.normalized_url) catByUrl.set(c.normalized_url, c);
    const urlByNorm = new Map<string, StartUrlMetric>();
    for (const u of startUrls) if (u.normalized_url) urlByNorm.set(u.normalized_url, u);

    // Build queries index by matched SEO url
    const qByUrl = new Map<string, Query[]>();
    for (const q of queries) {
      if (!q.url) continue;
      const arr = qByUrl.get(q.url) ?? [];
      arr.push(q);
      qByUrl.set(q.url, arr);
    }

    // Business-first: все URL из DataLens Categories попадают в группу,
    // даже если их нет в Topvisor (SEO-метрики будут пустыми).
    const keys = new Set<string>();
    for (const k of catByUrl.keys()) keys.add(k);
    for (const k of urlByNorm.keys()) if (topvisorUrls.has(k) || catByUrl.has(k)) keys.add(k);

    return Array.from(keys).map((norm) => {
      const u = urlByNorm.get(norm);
      const cat = catByUrl.get(norm);
      const matched = u?.matched_url_id ?? cat?.matched_url_id ?? null;
      const matchedGroup = u?.matched_group_id ?? cat?.matched_group_id ?? null;
      const matchStatus = u?.match_status ?? cat?.match_status ?? "unmatched";
      const qs = matched ? qByUrl.get(matched) ?? [] : [];
      const gp = qs.filter((q) => (q.googlePosition ?? 0) > 0).map((q) => q.googlePosition!);
      const yp = qs.filter((q) => (q.yandexPosition ?? 0) > 0).map((q) => q.yandexPosition!);
      const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const pctIn = (a: number[], n: number) => (a.length ? (a.filter((v) => v <= n).length / a.length) * 100 : null);
      const folder = matched && urls[matched]?.folder ? urls[matched]!.folder! : (qs[0]?.folder ?? null);
      const group = matched && urls[matched]?.group ? urls[matched]!.group! : (qs[0]?.group ?? matchedGroup ?? null);
      const metaStatus = matched ? metaEdits[matched]?.status ?? "—" : "—";
      const textStatus = matched ? texts[matched]?.status ?? "—" : "—";
      const updatedAt = Math.max(
        matched ? metaEdits[matched]?.updatedAt ?? 0 : 0,
        matched ? texts[matched]?.updatedAt ?? 0 : 0,
      );
      return {
        url: u?.url ?? cat?.category_url ?? norm,
        folder,
        group,
        gmv: (u?.gmv ?? 0) + (cat?.gmv ?? 0),
        goods: cat?.active_goods ?? null,
        sellers: cat?.sellers ?? null,
        visits: u?.visits ?? 0,
        orders: u?.orders ?? 0,
        avgY: avg(yp),
        avgG: avg(gp),
        top3Y: pctIn(yp, 3),
        top10Y: pctIn(yp, 10),
        top3G: pctIn(gp, 3),
        top10G: pctIn(gp, 10),
        metaStatus,
        textStatus,
        updatedAt,
        hasKeys: qs.length > 0,
        hasTopvisor: topvisorUrls.has(norm),
        match_status: matchStatus,
        matched_group_id: matchedGroup,
      };
    });
  }, [startUrls, categories, queries, urls, metaEdits, texts, topvisorUrls]);

  const filtered = useMemo(() => {
    let r = rows;
    if (onlyNoMeta) r = r.filter((x) => x.metaStatus === "—" || x.metaStatus === "not_started");
    if (onlyNoText) r = r.filter((x) => x.textStatus === "—" || x.textStatus === "not_assigned");
    if (outsideTop10) r = r.filter((x) => (x.top10G ?? 0) < 50 && (x.top10Y ?? 0) < 50);
    return [...r].sort((a, b) => {
      switch (sortBy) {
        case "visits": return b.visits - a.visits;
        case "orders": return b.orders - a.orders;
        case "top10g": return (b.top10G ?? -1) - (a.top10G ?? -1);
        default: return b.gmv - a.gmv;
      }
    });
  }, [rows, sortBy, onlyNoMeta, onlyNoText, outsideTop10]);

  if (loading) return <div className="text-sm text-muted-foreground">Загружаем данные DataLens…</div>;
  if (!rows.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Нет URL-строк из DataLens{stream ? ` для стрима «${stream}»` : ""}.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          Сортировка:
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="h-7 px-2 rounded-md border border-input bg-background"
          >
            <option value="gmv">GMV ↓</option>
            <option value="visits">Визиты ↓</option>
            <option value="orders">Заказы ↓</option>
            <option value="top10g">%TOP-10 G ↓</option>
          </select>
        </label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyNoMeta} onChange={(e) => setOnlyNoMeta(e.target.checked)} /> без мета</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={onlyNoText} onChange={(e) => setOnlyNoText(e.target.checked)} /> без текста</label>
        <label className="flex items-center gap-1"><input type="checkbox" checked={outsideTop10} onChange={(e) => setOutsideTop10(e.target.checked)} /> вне TOP-10</label>
        <span className="ml-auto text-muted-foreground">Всего: {filtered.length}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead className="text-muted-foreground bg-muted/30">
                <tr className="text-left">
                  <th className="py-1.5 px-2">URL</th>
                  <th className="py-1.5 px-2">Папка</th>
                  <th className="py-1.5 px-2">Группа</th>
                  <th className="py-1.5 px-2 text-right">GMV</th>
                  <th className="py-1.5 px-2 text-right">Товары</th>
                  <th className="py-1.5 px-2 text-right">Селлеры</th>
                  <th className="py-1.5 px-2 text-right">Визиты</th>
                  <th className="py-1.5 px-2 text-right">Заказы</th>
                  <th className="py-1.5 px-2 text-right">Ср.Y</th>
                  <th className="py-1.5 px-2 text-right">Ср.G</th>
                  <th className="py-1.5 px-2 text-right">TOP-3 Y</th>
                  <th className="py-1.5 px-2 text-right">TOP-10 Y</th>
                  <th className="py-1.5 px-2 text-right">TOP-3 G</th>
                  <th className="py-1.5 px-2 text-right">TOP-10 G</th>
                  <th className="py-1.5 px-2">Мета</th>
                  <th className="py-1.5 px-2">Текст</th>
                  <th className="py-1.5 px-2">Обновл.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((r, i) => (
                  <tr key={i} className="border-t border-border/40">
                    <td className="py-1 px-2 max-w-[260px] truncate" title={r.url}>
                      <span className="truncate">{r.url}</span>
                      {!r.hasTopvisor && (
                        <span className="ml-1 text-[10px] px-1 rounded bg-muted text-muted-foreground whitespace-nowrap">
                          нет данных Topvisor
                        </span>
                      )}
                    </td>
                    <td className="py-1 px-2">{r.folder ?? "—"}</td>
                    <td className="py-1 px-2">{r.group ?? "—"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{fmtNum(r.gmv)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.goods ?? "—"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.sellers ?? "—"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{fmtNum(r.visits)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{fmtNum(r.orders)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.avgY?.toFixed(1) ?? (r.hasKeys ? "—" : "н/д")}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.avgG?.toFixed(1) ?? (r.hasKeys ? "—" : "н/д")}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.top3Y != null ? `${r.top3Y.toFixed(0)}%` : r.hasTopvisor ? "—" : "н/д"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.top10Y != null ? `${r.top10Y.toFixed(0)}%` : r.hasTopvisor ? "—" : "н/д"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.top3G != null ? `${r.top3G.toFixed(0)}%` : r.hasTopvisor ? "—" : "н/д"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.top10G != null ? `${r.top10G.toFixed(0)}%` : r.hasTopvisor ? "—" : "н/д"}</td>
                    <td className="py-1 px-2">{r.metaStatus}</td>
                    <td className="py-1 px-2">{r.textStatus}</td>
                    <td className="py-1 px-2 text-muted-foreground">{r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 500 && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">Показаны первые 500 из {filtered.length}. Уточните фильтры.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "destructive" | "good" }) {
  const color =
    tone === "destructive" ? "text-destructive" : tone === "good" ? "text-chart-2" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
