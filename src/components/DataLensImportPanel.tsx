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
  saveDataLensImport,
  listDataLensImports,
  deleteDataLensImport,
} from "@/lib/datalens.functions";
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



export function DataLensImportPanel({ onLog }: { onLog?: (m: string) => void }) {
  const queries = useStore((s) => s.queries);
  const saveFn = useServerFn(saveDataLensImport);
  const listFn = useServerFn(listDataLensImports);
  const delFn = useServerFn(deleteDataLensImport);

  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sePriority, setSePriority] = useState<"any" | "google" | "yandex">("any");

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
    // Multi-source URL entries: relevant_g / relevant_y / target — с приоритетом по типам.
    const dedup = new Map<string, { url: string; normalized: string | null; folder: string | null; group: string | null; source: "relevant_g" | "relevant_y" | "target" }>();
    const add = (u: string | undefined, folder: string | null, group: string | null, source: "relevant_g" | "relevant_y" | "target") => {
      if (!u) return;
      const key = `${source}::${u}`;
      if (dedup.has(key)) return;
      dedup.set(key, { url: u, normalized: normalizeUrl(u), folder, group, source });
    };
    // Name hints: токены названий групп/папок для fallback-матчинга по имени в URL.
    const stop = new Set(["and", "for", "the", "com", "net", "org", "www", "все", "для", "или"]);
    const hintMap = new Map<string, { token: string; folder: string | null; group: string | null }>();
    const addHint = (name: string, folder: string | null, group: string | null) => {
      const tokens = name.toLowerCase().split(/[^a-zа-я0-9]+/i).filter((t) => t.length >= 3 && !stop.has(t));
      for (const t of tokens) {
        const key = `${t}::${folder}::${group}`;
        if (!hintMap.has(key)) hintMap.set(key, { token: t, folder, group });
      }
    };
    for (const q of queries) {
      add(q.relevantGoogle, q.folder ?? null, q.group ?? null, "relevant_g");
      add(q.relevantYandex, q.folder ?? null, q.group ?? null, "relevant_y");
      add(q.targetUrl, q.folder ?? null, q.group ?? null, "target");
      // Основной url — на случай, если target/relevant не сохранились отдельно.
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
    try {
      const records = await readRecords(file);
      const payload =
        type === "categories"
          ? { categories: parseCategoryRows(records) }
          : { start_urls: parseStartUrlRows(records) };
      const res = await saveFn({
        data: {
          type,
          stream: null,
          period_start: null,
          period_end: null,
          file_name: file.name,
          comment: null,
          seo_urls: seoUrls,
          name_hints: nameHints,
          se_priority: sePriority,
          ...payload,
        },
      });
      toast.success(
        `Импорт готов: всего ${res.rows_total}, сматчено ${res.rows_matched}, без матча ${res.rows_unmatched}`,
      );
      onLog?.(
        `DataLens ${type}: ${file.name} — всего ${res.rows_total}, сматчено ${res.rows_matched}, без матча ${res.rows_unmatched}`,
      );
      await refresh();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      toast.error(m);
      onLog?.(`Ошибка DataLens ${type}: ${m}`);
    } finally {
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
          hint="GMV, товары, селлеры, иерархия категорий."
          type="categories"
          disabled={loading}
          onUpload={handleUpload}
        />
        <UploadCard
          title="DataLens Start URL"
          hint="Визиты, пользователи, заказы, GMV, конверсии, доля Я/G."
          type="start_url"
          disabled={loading}
          onUpload={handleUpload}
        />
      </div>

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
          Стрим/папка/группа определяются автоматически по маппингу URL в Topvisor.
        </div>
      </CardContent>
    </Card>
  );
}
