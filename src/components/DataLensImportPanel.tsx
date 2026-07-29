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

const STREAMS = ["Gaming", "Non-gaming", "Новинки"];

export function DataLensImportPanel({ onLog }: { onLog?: (m: string) => void }) {
  const queries = useStore((s) => s.queries);
  const saveFn = useServerFn(saveDataLensImport);
  const listFn = useServerFn(listDataLensImports);
  const delFn = useServerFn(deleteDataLensImport);

  const [imports, setImports] = useState<ImportRow[]>([]);
  const [loading, setLoading] = useState(false);

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

  const seoUrls = useMemo(() => {
    const map = new Map<string, { folder: string | null; group: string | null }>();
    for (const q of queries) {
      if (!q.url) continue;
      if (!map.has(q.url)) map.set(q.url, { folder: q.folder ?? null, group: q.group ?? null });
    }
    return Array.from(map.entries()).map(([url, v]) => ({
      url,
      normalized: normalizeUrl(url),
      folder: v.folder,
      group: v.group,
    }));
  }, [queries]);

  async function handleUpload(type: DataLensType, form: FormValues, file: File) {
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
          stream: form.stream || null,
          period_start: form.period_start || null,
          period_end: form.period_end || null,
          file_name: file.name,
          comment: form.comment || null,
          seo_urls: seoUrls,
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

interface FormValues {
  stream: string;
  period_start: string;
  period_end: string;
  comment: string;
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
  onUpload: (type: DataLensType, form: FormValues, file: File) => Promise<void>;
}) {
  const [form, setForm] = useState<FormValues>({ stream: STREAMS[0], period_start: "", period_end: "", comment: "" });

  return (
    <Card>
      <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">{hint}</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs mb-1 block">Стрим</Label>
            <select
              value={form.stream}
              onChange={(e) => setForm((f) => ({ ...f, stream: e.target.value }))}
              className="w-full h-8 text-xs px-2 rounded-md border border-input bg-background"
            >
              {STREAMS.map((s) => <option key={s} value={s}>{s}</option>)}
              <option value="">— другое —</option>
            </select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Период с</Label>
            <Input type="date" value={form.period_start} onChange={(e) => setForm((f) => ({ ...f, period_start: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Период по</Label>
            <Input type="date" value={form.period_end} onChange={(e) => setForm((f) => ({ ...f, period_end: e.target.value }))} className="h-8 text-xs" />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Комментарий</Label>
            <Input value={form.comment} onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))} className="h-8 text-xs" />
          </div>
        </div>
        <div>
          <Label className="text-xs mb-1 block">Файл (.xlsx / .csv)</Label>
          <Input
            type="file"
            accept=".xlsx,.xls,.csv"
            disabled={disabled}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              await onUpload(type, form, f);
              e.target.value = "";
            }}
            className="h-8 text-xs"
          />
        </div>
      </CardContent>
    </Card>
  );
}
