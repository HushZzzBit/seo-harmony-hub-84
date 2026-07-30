import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  readRecords,
  parseCategoryRows,
  parseStartUrlRows,
  type DataLensType,
} from "@/lib/datalens";
import {
  createDataLensImport,
  appendDataLensRows,
  finalizeDataLensImport,
  listDataLensImports,
  deleteDataLensImport,
  listGroupMappingsFn,
} from "@/lib/datalens.functions";
import { buildGroupResolver, type AliasEntry } from "@/lib/group-alias";
import { buildMatchIndex, matchOne, type SePriority } from "@/lib/datalens-match";
import { useStore } from "@/lib/store";
import { normalizeUrl } from "@/lib/datalens";
import { Trash2 } from "lucide-react";

interface ImportRow {
  id: string;
  type: DataLensType;
  stream: string | null;
  period_start: string | null;
  period_end: string | null;
  uploaded_at: string;
  file_name: string | null;
  rows_total: number;
  rows_matched: number;
  rows_unmatched: number;
  status: string;
}

const CHUNK_SIZE = 400;

export function DataLensImportPanel({ onLog }: { onLog?: (m: string) => void }) {
  const queries = useStore((s) => s.queries);
  const createFn = useServerFn(createDataLensImport);
  const appendFn = useServerFn(appendDataLensRows);
  const finalizeFn = useServerFn(finalizeDataLensImport);
  const listFn = useServerFn(listDataLensImports);
  const delFn = useServerFn(deleteDataLensImport);
  const listMappingsFn = useServerFn(listGroupMappingsFn);

  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [sePriority, setSePriority] = useState<SePriority>("any");
  const [unresolved, setUnresolved] = useState<Array<{ name: string; count: number }>>([]);

  const refresh = async () => {
    try {
      const r = (await listFn()) as ImportRow[];
      setImports(r);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { seoUrls, nameHints } = useMemo(() => {
    const dedup = new Map<string, { url: string; normalized: string | null; folder: string | null; group: string | null; source: "relevant_g" | "relevant_y" | "target" }>();
    const add = (u: string | undefined, folder: string | null, group: string | null, source: "relevant_g" | "relevant_y" | "target") => {
      if (!u) return;
      const key = `${source}::${u}`;
      if (dedup.has(key)) return;
      dedup.set(key, { url: u, normalized: normalizeUrl(u), folder, group, source });
    };
    const stop = new Set(["and", "for", "the", "com", "net", "org", "www", "все", "для", "или"]);
    const hintMap = new Map<string, { tokens: string[]; folder: string | null; group: string | null }>();
    const addHint = (name: string, folder: string | null, group: string | null) => {
      const tokens = Array.from(new Set(
        name.toLowerCase().split(/[^a-zа-я0-9]+/i).filter((t) => t.length >= 3 && !stop.has(t)),
      ));
      if (!tokens.length) return;
      const key = `${tokens.join("+")}::${folder}::${group}`;
      if (!hintMap.has(key)) hintMap.set(key, { tokens, folder, group });
    };
    for (const q of queries) {
      add(q.relevantGoogle, q.folder ?? null, q.group ?? null, "relevant_g");
      add(q.relevantYandex, q.folder ?? null, q.group ?? null, "relevant_y");
      add(q.targetUrl, q.folder ?? null, q.group ?? null, "target");
      if (q.url && !q.targetUrl && !q.relevantGoogle && !q.relevantYandex) {
        add(q.url, q.folder ?? null, q.group ?? null, "target");
      }
      if (q.group) addHint(q.group, q.folder ?? null, q.group ?? null);
      if (q.folder) addHint(q.folder, q.folder ?? null, q.group ?? null);
    }
    return { seoUrls: Array.from(dedup.values()), nameHints: Array.from(hintMap.values()) };
  }, [queries]);

  async function handleUpload(type: DataLensType, file: File) {
    setLoading(true);
    setProgress("Читаем файл…");
    try {
      const records = await readRecords(file);
      const parsed = type === "categories" ? parseCategoryRows(records) : parseStartUrlRows(records);
      const rows_total = parsed.length;
      if (!rows_total) throw new Error("Файл не содержит распознаваемых строк");

      // Match on the client — pure logic, no server memory pressure.
      setProgress(`Матчинг ${rows_total} строк…`);
      const idx = buildMatchIndex(seoUrls, nameHints);
      const aliases = (await listMappingsFn()) as AliasEntry[];
      const resolver = buildGroupResolver(queries, aliases);
      let matched = 0;
      let unmatched = 0;
      const unresolvedNames = new Map<string, number>();
      const enriched = parsed.map((r) => {
        if (type === "categories") {
          // Group-first: Base category — основной ключ. URL из Category URL
          // подтягивается в группу и не обязан существовать в Topvisor.
          const bc = (r as { base_category?: string | null }).base_category ?? null;
          const hit = resolver.resolve(bc);
          const urlMatch = matchOne(r.normalized_url, idx, sePriority);
          if (hit) {
            matched++;
            const status =
              hit.match_type === "manual"
                ? "matched_by_manual"
                : hit.match_type === "alias"
                  ? "matched_by_alias"
                  : "matched_by_base_category";
            return { ...r, matched_url_id: urlMatch.matched_url_id, matched_group_id: hit.group, match_status: status };
          }
          unmatched++;
          if (bc) unresolvedNames.set(bc, (unresolvedNames.get(bc) ?? 0) + 1);
          return { ...r, matched_url_id: urlMatch.matched_url_id, matched_group_id: null, match_status: "unmatched_base_category" };
        }
        const m = matchOne(r.normalized_url, idx, sePriority);
        if (m.match_status === "unmatched" || m.match_status === "ambiguous_slug") unmatched++;
        else matched++;
        return { ...r, ...m };
      });
      setUnresolved(
        Array.from(unresolvedNames.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
      );


      // Create import, then stream chunks. On any failure — mark import failed.
      const { importId } = await createFn({ data: { type, file_name: file.name, rows_total } });
      try {
        for (let i = 0; i < enriched.length; i += CHUNK_SIZE) {
          const chunk = enriched.slice(i, i + CHUNK_SIZE);
          await appendFn({ data: { importId, type, rows: chunk as never } });
          setProgress(`Загружено ${Math.min(i + CHUNK_SIZE, enriched.length)} / ${enriched.length}…`);
        }
        await finalizeFn({ data: { importId, rows_matched: matched, rows_unmatched: unmatched, status: "ready" } });
      } catch (chunkErr) {
        const em = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
        await finalizeFn({ data: { importId, rows_matched: matched, rows_unmatched: unmatched, status: "failed", error_message: em } }).catch(() => {});
        throw chunkErr;
      }

      toast.success(`Импорт готов: всего ${rows_total}, сматчено ${matched}, без матча ${unmatched}`);
      onLog?.(`DataLens ${type}: ${file.name} — всего ${rows_total}, сматчено ${matched}, без матча ${unmatched}`);
      await refresh();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      toast.error(m);
      onLog?.(`Ошибка DataLens ${type}: ${m}`);
    } finally {
      setProgress(null);
      setLoading(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Удалить импорт и все его строки?")) return;
    try {
      await delFn({ data: { id } });
      toast.success("Импорт удалён");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }


  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="text-muted-foreground">Приоритет ПС при матчинге релевантных URL:</span>
          {(["any", "google", "yandex"] as const).map((v) => (
            <label key={v} className="flex items-center gap-1 cursor-pointer">
              <input
                type="radio"
                name="se-priority"
                checked={sePriority === v}
                onChange={() => setSePriority(v)}
              />
              {v === "any" ? "Обе ПС" : v === "google" ? "Google" : "Яндекс"}
            </label>
          ))}
          <span className="ml-auto text-muted-foreground">
            Источников URL: {seoUrls.length} · токенов имён: {nameHints.length}
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <UploadCard
          title="DataLens Categories"
          hint="GMV, товары, селлеры."
          type="categories"
          disabled={loading}
          onUpload={handleUpload}
        />
        <UploadCard
          title="DataLens Start URL"
          hint="Визиты, заказы, GMV, доля Я/G."
          type="start_url"
          disabled={loading}
          onUpload={handleUpload}
        />
      </div>

      {progress && (
        <div className="text-xs text-muted-foreground px-1">{progress}</div>
      )}


      {unresolved.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive">
              Несопоставленные Base category ({unresolved.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs max-h-48 overflow-auto">
            {unresolved.map((u) => (
              <div key={u.name} className="flex justify-between gap-2">
                <span className="truncate" title={u.name}>{u.name}</span>
                <span className="tabular-nums text-muted-foreground">{u.count}</span>
              </div>
            ))}
            <div className="pt-2 text-muted-foreground">
              Привязать вручную: Настройки → DataLens → Маппинг групп.
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm">История импортов DataLens ({imports.length})</CardTitle>
          <Button size="sm" variant="ghost" onClick={refresh}>Обновить</Button>
        </CardHeader>
        <CardContent>
          {imports.length === 0 ? (
            <div className="text-xs text-muted-foreground">Импортов пока нет</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-1 pr-2">Дата</th>
                    <th className="py-1 pr-2">Тип</th>
                    <th className="py-1 pr-2">Стрим</th>
                    <th className="py-1 pr-2">Период</th>
                    <th className="py-1 pr-2">Файл</th>
                    <th className="py-1 pr-2 text-right">Всего</th>
                    <th className="py-1 pr-2 text-right">Матч</th>
                    <th className="py-1 pr-2 text-right">Без матча</th>
                    <th className="py-1 pr-2">Статус</th>
                    <th className="py-1"></th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((i) => (
                    <tr key={i.id} className="border-t border-border/50">
                      <td className="py-1 pr-2 font-mono">{new Date(i.uploaded_at).toLocaleString()}</td>
                      <td className="py-1 pr-2">{i.type === "categories" ? "Categories" : "Start URL"}</td>
                      <td className="py-1 pr-2">{i.stream ?? "—"}</td>
                      <td className="py-1 pr-2">{i.period_start || ""}{i.period_end ? ` … ${i.period_end}` : ""}</td>
                      <td className="py-1 pr-2 max-w-[220px] truncate" title={i.file_name ?? ""}>{i.file_name ?? "—"}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{i.rows_total}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-chart-2">{i.rows_matched}</td>
                      <td className="py-1 pr-2 text-right tabular-nums text-destructive">{i.rows_unmatched}</td>
                      <td className="py-1 pr-2">{i.status}</td>
                      <td className="py-1 text-right">
                        <button
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(i.id)}
                          title="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UploadCard({
  title,
  hint,
  type,
  disabled,
  onUpload,
}: {
  title: string;
  hint: string;
  type: DataLensType;
  disabled: boolean;
  onUpload: (type: DataLensType, file: File) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">{hint}</div>
        <div>
          <Label className="text-xs mb-1 block">Файл (.xlsx / .csv)</Label>
          <Input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={disabled}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              await onUpload(type, f);
              e.target.value = "";
            }}
            className="h-8 text-xs"
          />
        </div>
        <div className="text-[11px] text-muted-foreground">
          Стрим и группа — автоматически по маппингу Topvisor.
        </div>
      </CardContent>
    </Card>
  );
}
