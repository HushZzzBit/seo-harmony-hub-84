// Единый URL-инвентарь группы: объединение (union) источников
//   Topvisor (целевые/релевантные/найденные по ключам URL)
//   DataLens Categories (Category URL сматченных Base category)
//   DataLens Start URL
// URL не удаляется из группы, если он отсутствует во втором источнике.
import { normalizeUrl, isProductUrl } from "./datalens";
import type { Query, UrlRow, MetaEdit, TextRow } from "./types";

export interface InventoryCategoryRow {
  normalized_url: string | null;
  category_url?: string | null;
  active_goods?: number | null;
  sellers?: number | null;
  gmv?: number | null;
  matched_url_id?: string | null;
  matched_group_id?: string | null;
}
export interface InventoryStartUrlRow {
  normalized_url: string | null;
  url?: string | null;
  visits?: number | null;
  orders?: number | null;
  gmv?: number | null;
  matched_url_id?: string | null;
  matched_group_id?: string | null;
}

export interface InventoryRow {
  normalizedUrl: string;
  url: string;
  folder: string | null;
  group: string | null;
  sourceTopvisor: boolean;
  sourceDataLensCategories: boolean;
  sourceDataLensStartUrl: boolean;
  hasSeoMetrics: boolean;
  hasBusinessMetrics: boolean;
  gmv: number;
  goods: number | null;
  sellers: number | null;
  visits: number;
  orders: number;
  avgY: number | null;
  avgG: number | null;
  top3Y: number | null;
  top10Y: number | null;
  top3G: number | null;
  top10G: number | null;
  metaStatus: string;
  textStatus: string;
}

export interface InventoryInput {
  queries: Query[];
  categories: InventoryCategoryRow[];
  startUrls: InventoryStartUrlRow[];
  urls: Record<string, UrlRow>;
  metaEdits: Record<string, MetaEdit>;
  texts: Record<string, TextRow>;
  /** Ограничение выборки Topvisor: конкретная группа либо набор групп папки. */
  group?: string | null;
  folderGroups?: Set<string> | null;
}

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const pctIn = (a: number[], n: number) => (a.length ? (a.filter((v) => v <= n).length / a.length) * 100 : null);

export function buildGroupUrlInventory(input: InventoryInput): InventoryRow[] {
  const { queries, categories, startUrls, urls, metaEdits, texts, group, folderGroups } = input;

  const inScope = (q: Query) => {
    if (group) return q.group === group;
    if (folderGroups) return !!q.group && folderGroups.has(q.group);
    return true;
  };

  // norm -> данные Topvisor
  interface TvAgg {
    original: string;
    folder: string | null;
    group: string | null;
    gp: number[];
    yp: number[];
  }
  const tv = new Map<string, TvAgg>();
  for (const q of queries) {
    if (!inScope(q)) continue;
    const raw = [q.url, q.targetUrl, q.relevantGoogle, q.relevantYandex].filter(Boolean) as string[];
    for (const r of raw) {
      const n = normalizeUrl(r);
      if (!n) continue;
      const cur =
        tv.get(n) ?? { original: r, folder: q.folder ?? null, group: q.group ?? null, gp: [], yp: [] };
      if ((q.googlePosition ?? 0) > 0) cur.gp.push(q.googlePosition!);
      if ((q.yandexPosition ?? 0) > 0) cur.yp.push(q.yandexPosition!);
      if (!cur.group && q.group) cur.group = q.group;
      if (!cur.folder && q.folder) cur.folder = q.folder;
      tv.set(n, cur);
    }
  }

  const catByUrl = new Map<string, InventoryCategoryRow>();
  for (const c of categories) if (c.normalized_url) catByUrl.set(c.normalized_url, c);
  const suByUrl = new Map<string, InventoryStartUrlRow>();
  for (const u of startUrls) if (u.normalized_url) suByUrl.set(u.normalized_url, u);

  // norm -> исходный URL из справочника store (для статусов мета/текста)
  const originalByNorm = new Map<string, string>();
  for (const u of Object.keys(urls)) {
    const n = normalizeUrl(u);
    if (n && !originalByNorm.has(n)) originalByNorm.set(n, u);
  }

  const keys = new Set<string>([...tv.keys(), ...catByUrl.keys(), ...suByUrl.keys()]);

  const out: InventoryRow[] = [];
  for (const norm of keys) {
    if (isProductUrl(norm)) continue;
    const t = tv.get(norm);
    const c = catByUrl.get(norm);
    const s = suByUrl.get(norm);
    const storeUrl = originalByNorm.get(norm) ?? c?.matched_url_id ?? s?.matched_url_id ?? null;
    const gmv = (c?.gmv ?? 0) + (s?.gmv ?? 0);
    const hasBusiness = !!c || !!s;
    const hasSeo = !!t && (t.gp.length > 0 || t.yp.length > 0);
    out.push({
      normalizedUrl: norm,
      url: t?.original ?? c?.category_url ?? s?.url ?? norm,
      folder: t?.folder ?? (storeUrl ? urls[storeUrl]?.folder ?? null : null),
      group:
        t?.group ??
        c?.matched_group_id ??
        s?.matched_group_id ??
        (storeUrl ? urls[storeUrl]?.group ?? null : null),
      sourceTopvisor: !!t,
      sourceDataLensCategories: !!c,
      sourceDataLensStartUrl: !!s,
      hasSeoMetrics: hasSeo,
      hasBusinessMetrics: hasBusiness,
      gmv,
      goods: c?.active_goods ?? null,
      sellers: c?.sellers ?? null,
      visits: s?.visits ?? 0,
      orders: s?.orders ?? 0,
      avgY: t ? avg(t.yp) : null,
      avgG: t ? avg(t.gp) : null,
      top3Y: t ? pctIn(t.yp, 3) : null,
      top10Y: t ? pctIn(t.yp, 10) : null,
      top3G: t ? pctIn(t.gp, 3) : null,
      top10G: t ? pctIn(t.gp, 10) : null,
      metaStatus: storeUrl ? metaEdits[storeUrl]?.status ?? "—" : "—",
      textStatus: storeUrl ? texts[storeUrl]?.status ?? "—" : "—",
    });
  }
  return out;
}

export type CoverageFilter =
  | "all"
  | "topvisor_only"
  | "datalens_only"
  | "both"
  | "no_seo"
  | "no_business";

export function applyCoverageFilter(rows: InventoryRow[], f: CoverageFilter): InventoryRow[] {
  const isDl = (r: InventoryRow) => r.sourceDataLensCategories || r.sourceDataLensStartUrl;
  switch (f) {
    case "topvisor_only":
      return rows.filter((r) => r.sourceTopvisor && !isDl(r));
    case "datalens_only":
      return rows.filter((r) => !r.sourceTopvisor && isDl(r));
    case "both":
      return rows.filter((r) => r.sourceTopvisor && isDl(r));
    case "no_seo":
      return rows.filter((r) => !r.hasSeoMetrics);
    case "no_business":
      return rows.filter((r) => !r.hasBusinessMetrics);
    default:
      return rows;
  }
}

export function sourceLabel(r: InventoryRow): string {
  const dl = r.sourceDataLensCategories || r.sourceDataLensStartUrl;
  if (r.sourceTopvisor && dl) return "Topvisor + DataLens";
  if (r.sourceTopvisor) return "Topvisor";
  return "DataLens";
}
