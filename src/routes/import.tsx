import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { downloadCsv, parseNetpeak, parseSeasonality, parseTopvisorQueries, readTabular, toCsv } from "@/lib/csv";
import { toast } from "sonner";
import { metaFor } from "@/lib/seo";

export const Route = createFileRoute("/import")({
  ssr: false,
  component: () => <ClientOnly fallback={null}><ImportPage /></ClientOnly>,
});

function ImportPage() {
  const { upsertQueries, upsertUrls, applySeasonality, queries, urls, metaEdits, texts, clearAll } = useStore();
  const [log, setLog] = useState<string[]>([]);
  const add = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()} — ${m}`, ...l].slice(0, 20));

  async function handleFile(kind: "topvisor" | "seasonality" | "netpeak", file: File) {
    try {
      const rows = await readTabular(file);
      if (kind === "topvisor") {
        const parsed = parseTopvisorQueries(rows);
        upsertQueries(parsed);
        add(`Topvisor: загружено ${parsed.length} запросов из ${file.name}`);
        toast.success(`Загружено ${parsed.length} запросов`);
      } else if (kind === "seasonality") {
        const map = parseSeasonality(rows);
        applySeasonality(map);
        add(`Сезонность: применена к ${Object.keys(map).length} запросам`);
        toast.success("Сезонность применена");
      } else {
        const parsed = parseNetpeak(rows);
        upsertUrls(parsed);
        add(`Netpeak: загружено ${parsed.length} URL из ${file.name}`);
        toast.success(`Загружено ${parsed.length} URL`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      add(`Ошибка: ${msg}`);
      toast.error(msg);
    }
  }

  function exportCms() {
    const seen = new Set<string>();
    const out: Record<string, unknown>[] = [];
    for (const q of queries) {
      const u = q.url; if (!u || seen.has(u)) continue; seen.add(u);
      const m = metaFor(u, urls, metaEdits);
      out.push({
        url: u,
        title: m.h1,
        seo_title: m.title,
        seo_desc: m.description,
        seo_text: texts[u]?.text ?? urls[u]?.text ?? "",
      });
    }
    if (!out.length) { toast.error("Нет данных для экспорта"); return; }
    downloadCsv(`seo-export-${Date.now()}.csv`, toCsv(out));
    toast.success(`Экспортировано ${out.length} URL`);
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Import / Export</h1>
        <p className="text-sm text-muted-foreground">Загрузка CSV из Topvisor и Netpeak, экспорт для CMS</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <ImportCard
          title="Topvisor — Запросы"
          desc="Колонки: Запрос, Папка, Группа, URL, Частота, Google, Yandex"
          onFile={(f) => handleFile("topvisor", f)}
        />
        <ImportCard
          title="Topvisor — Сезонность"
          desc="Колонки: Запрос, Янв, Фев, …, Дек"
          onFile={(f) => handleFile("seasonality", f)}
        />
        <ImportCard
          title="Netpeak Checker"
          desc="Колонки: URL, Title, Description, H1, Длина текста"
          onFile={(f) => handleFile("netpeak", f)}
        />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Экспорт CSV для CMS</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">Поля: url, title (=H1), seo_title (=Title), seo_desc, seo_text</div>
          <Button onClick={exportCms}>Скачать CSV</Button>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>Состояние хранилища</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>Запросов: <b>{queries.length}</b></div>
          <div>URL: <b>{Object.keys(urls).length}</b></div>
          <div>Правок Meta: <b>{Object.keys(metaEdits).length}</b></div>
          <div>Текстов: <b>{Object.keys(texts).length}</b></div>
          <Button
            variant="destructive"
            size="sm"
            className="mt-2"
            onClick={() => { if (confirm("Удалить все данные?")) { clearAll(); toast.success("Очищено"); } }}
          >Очистить всё</Button>
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Журнал</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-xs font-mono space-y-1">
              {log.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}

function ImportCard({ title, desc, onFile }: { title: string; desc: string; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">{desc}</p>
        <input
          ref={ref}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
        <Button variant="outline" onClick={() => ref.current?.click()} className="w-full">Выбрать CSV</Button>
      </CardContent>
    </Card>
  );
}
