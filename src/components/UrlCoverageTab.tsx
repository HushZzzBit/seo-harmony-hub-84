// Вкладка «URL Coverage»: объединённый набор URL группы из Topvisor и DataLens.
import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useStore } from "@/lib/store";
import { useTableSort, SortTh } from "@/hooks/use-table-sort";
import {
  useDataLens,
  useFolderGroups,
  useUrlOwnershipMap,
  filterByFolder,
} from "@/components/DashboardDataLensTabs";
import {
  buildGroupUrlInventory,
  applyCoverageFilter,
  sourceLabel,
  type CoverageFilter,
} from "@/lib/url-inventory";

type CovSortKey =
  | "url"
  | "source"
  | "hasSeoMetrics"
  | "hasBusinessMetrics"
  | "gmv"
  | "goods"
  | "sellers"
  | "avgY"
  | "avgG"
  | "top10G"
  | "metaStatus"
  | "textStatus";

const FILTERS: Array<{ v: CoverageFilter; label: string }> = [
  { v: "all", label: "Все URL" },
  { v: "topvisor_only", label: "Только Topvisor" },
  { v: "datalens_only", label: "Только DataLens" },
  { v: "both", label: "Есть в обоих" },
  { v: "no_seo", label: "Без SEO-метрик" },
  { v: "no_business", label: "Без бизнес-метрик" },
];

function fmtNum(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n);
}

export function UrlCoverageTab({ stream, group }: { stream: string | null; group?: string | null }) {
  const folderGroups = useFolderGroups(stream);
  const requestGroups = useMemo(
    () => (group ? [group] : folderGroups ? Array.from(folderGroups) : null),
    [group, folderGroups],
  );
  const { categories: allCategories, startUrls: allStartUrls, loading } = useDataLens(null, requestGroups);
  const ownership = useUrlOwnershipMap();
  const queries = useStore((s) => s.queries);
  const urls = useStore((s) => s.urls);
  const metaEdits = useStore((s) => s.metaEdits);
  const texts = useStore((s) => s.texts);
  const [filter, setFilter] = useState<CoverageFilter>("all");

  const rows = useMemo(() => {
    const categories = filterByFolder(allCategories, folderGroups, group, ownership);
    const startUrls = filterByFolder(allStartUrls, folderGroups, group, ownership);
    return buildGroupUrlInventory({
      queries,
      categories,
      startUrls,
      urls,
      metaEdits,
      texts,
      group: group ?? null,
      folderGroups,
    }).sort((a, b) => b.gmv - a.gmv);
  }, [allCategories, allStartUrls, folderGroups, group, ownership, queries, urls, metaEdits, texts]);

  const stats = useMemo(() => {
    const withBiz = rows.filter((r) => r.hasBusinessMetrics).length;
    const withSeo = rows.filter((r) => r.hasSeoMetrics).length;
    return {
      total: rows.length,
      withBiz,
      withSeo,
      noBiz: rows.length - withBiz,
      noSeo: rows.length - withSeo,
    };
  }, [rows]);

  const filtered = useMemo(() => applyCoverageFilter(rows, filter), [rows, filter]);

  if (loading) return <div className="text-sm text-muted-foreground">Загружаем данные…</div>;
  if (!rows.length) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Нет URL в выбранной области. Подтяните Topvisor или загрузите выгрузки DataLens.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="URL всего (union)" value={stats.total} />
        <Stat label="С бизнес-метриками" value={stats.withBiz} />
        <Stat label="С SEO-метриками" value={stats.withSeo} />
        <Stat label="Без бизнес-метрик" value={stats.noBiz} tone />
        <Stat label="Без SEO-метрик" value={stats.noSeo} tone />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {FILTERS.map((f) => (
          <button
            key={f.v}
            onClick={() => setFilter(f.v)}
            className={`h-7 px-2.5 rounded-md border ${
              filter === f.v ? "bg-primary text-primary-foreground border-transparent" : "border-input bg-background"
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-muted-foreground">Показано: {filtered.length}</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead className="text-muted-foreground bg-muted/30">
                <tr className="text-left">
                  <th className="py-1.5 px-2">URL</th>
                  <th className="py-1.5 px-2">Источник</th>
                  <th className="py-1.5 px-2">SEO</th>
                  <th className="py-1.5 px-2">Бизнес</th>
                  <th className="py-1.5 px-2 text-right">GMV</th>
                  <th className="py-1.5 px-2 text-right">Товары</th>
                  <th className="py-1.5 px-2 text-right">Селлеры</th>
                  <th className="py-1.5 px-2 text-right">Ср.Y</th>
                  <th className="py-1.5 px-2 text-right">Ср.G</th>
                  <th className="py-1.5 px-2 text-right">TOP-3 / TOP-10</th>
                  <th className="py-1.5 px-2">Мета</th>
                  <th className="py-1.5 px-2">Текст</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((r) => (
                  <tr key={r.normalizedUrl} className="border-t border-border/40">
                    <td className="py-1 px-2 max-w-[280px] truncate" title={r.url}>{r.url}</td>
                    <td className="py-1 px-2 whitespace-nowrap">{sourceLabel(r)}</td>
                    <td className="py-1 px-2">{r.hasSeoMetrics ? "да" : "нет"}</td>
                    <td className="py-1 px-2">{r.hasBusinessMetrics ? "да" : "нет"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{fmtNum(r.gmv)}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.goods ?? "—"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.sellers ?? "—"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.avgY?.toFixed(1) ?? "н/д"}</td>
                    <td className="py-1 px-2 text-right tabular-nums">{r.avgG?.toFixed(1) ?? "н/д"}</td>
                    <td className="py-1 px-2 text-right tabular-nums whitespace-nowrap">
                      {r.top3G != null || r.top10G != null
                        ? `${r.top3G?.toFixed(0) ?? 0}% / ${r.top10G?.toFixed(0) ?? 0}%`
                        : "н/д"}
                    </td>
                    <td className="py-1 px-2">{r.metaStatus}</td>
                    <td className="py-1 px-2">{r.textStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length > 500 && (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              Показаны первые 500 из {filtered.length}.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${tone ? "text-destructive" : "text-foreground"}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
