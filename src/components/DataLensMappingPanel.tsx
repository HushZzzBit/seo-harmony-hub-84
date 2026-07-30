// Настройки → DataLens → Маппинг групп: привязка Base category к группам сервиса.
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useStore } from "@/lib/store";
import {
  listGroupMappingsFn,
  upsertGroupMappingFn,
  deleteGroupMappingFn,
  getDataLensMetrics,
} from "@/lib/datalens.functions";
import { buildGroupResolver, normalizeGroupName, type AliasEntry } from "@/lib/group-alias";

interface MappingRow {
  id: string;
  external_name_raw: string;
  external_name_normalized: string;
  matched_group_id: string | null;
  matched_folder: string | null;
  match_type: string;
}

export function DataLensMappingPanel() {
  const queries = useStore((s) => s.queries);
  const listFn = useServerFn(listGroupMappingsFn);
  const upsertFn = useServerFn(upsertGroupMappingFn);
  const delFn = useServerFn(deleteGroupMappingFn);
  const metricsFn = useServerFn(getDataLensMetrics);

  const [rows, setRows] = useState<MappingRow[]>([]);
  const [externals, setExternals] = useState<Array<{ raw: string; count: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [m, metrics] = await Promise.all([
        listFn() as Promise<MappingRow[]>,
        metricsFn({ data: { stream: null } }),
      ]);
      setRows(m);
      const counts = new Map<string, number>();
      for (const c of metrics.categories) {
        const bc = c.base_category;
        if (!bc) continue;
        counts.set(bc, (counts.get(bc) ?? 0) + 1);
      }
      setExternals(
        Array.from(counts.entries())
          .map(([raw, count]) => ({ raw, count }))
          .sort((a, b) => b.count - a.count),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolver = useMemo(() => buildGroupResolver(queries, rows as AliasEntry[]), [queries, rows]);

  const list = useMemo(() => {
    const q = filter.toLowerCase().trim();
    return externals
      .filter((e) => !q || e.raw.toLowerCase().includes(q))
      .map((e) => ({ ...e, resolved: resolver.resolve(e.raw) }));
  }, [externals, filter, resolver]);

  const unresolvedCount = list.filter((l) => !l.resolved).length;

  async function setMapping(raw: string, group: string) {
    const target = resolver.groups.find((g) => g.group === group) ?? null;
    try {
      await upsertFn({
        data: {
          external_name_raw: raw,
          external_name_normalized: normalizeGroupName(raw),
          matched_group_id: group || null,
          matched_folder: target?.folder ?? null,
          match_type: "manual",
        },
      });
      toast.success("Привязка сохранена");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeMapping(id: string) {
    try {
      await delFn({ data: { id } });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">
          Маппинг групп DataLens · без привязки: {unresolvedCount}
        </CardTitle>
        <div className="flex items-center gap-2">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Поиск Base category"
            className="h-8 text-xs w-56"
          />
          <Button size="sm" variant="ghost" onClick={load} disabled={loading}>Обновить</Button>
        </div>
      </CardHeader>
      <CardContent>
        {list.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {loading ? "Загружаем…" : "Нет данных DataLens Categories."}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[520px]">
            <table className="text-xs w-full">
              <thead className="text-muted-foreground bg-muted/30 sticky top-0">
                <tr className="text-left">
                  <th className="py-1.5 px-2">Base category</th>
                  <th className="py-1.5 px-2 text-right">URL</th>
                  <th className="py-1.5 px-2">Группа сервиса</th>
                  <th className="py-1.5 px-2">Тип</th>
                  <th className="py-1.5 px-2"></th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => {
                  const manual = rows.find((r) => r.external_name_normalized === normalizeGroupName(e.raw));
                  return (
                    <tr key={e.raw} className="border-t border-border/40">
                      <td className="py-1 px-2 max-w-[280px] truncate" title={e.raw}>{e.raw}</td>
                      <td className="py-1 px-2 text-right tabular-nums">{e.count}</td>
                      <td className="py-1 px-2">
                        <select
                          value={e.resolved?.group ?? ""}
                          onChange={(ev) => setMapping(e.raw, ev.target.value)}
                          className="h-7 px-1 rounded-md border border-input bg-background max-w-[240px]"
                        >
                          <option value="">— не сопоставлено —</option>
                          {resolver.groups.map((g) => (
                            <option key={`${g.folder}::${g.group}`} value={g.group}>
                              {g.group}{g.folder ? ` (${g.folder})` : ""}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 px-2 text-muted-foreground">
                        {e.resolved ? e.resolved.match_type : "—"}
                      </td>
                      <td className="py-1 px-2 text-right">
                        {manual && (
                          <button
                            className="text-muted-foreground hover:text-destructive"
                            onClick={() => removeMapping(manual.id)}
                            title="Удалить ручную привязку"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
