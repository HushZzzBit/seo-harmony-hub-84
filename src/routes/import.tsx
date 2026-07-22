import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStore } from "@/lib/store";
import { downloadCsv, parseNetpeak, parseSeasonality, parseTopvisorQueries, readMatrix, toCsv } from "@/lib/csv";
import { toast } from "sonner";
import { metaFor } from "@/lib/seo";

export const Route = createFileRoute("/import")({
  ssr: false,
  component: () => <ClientOnly fallback={null}><ImportPage /></ClientOnly>,
});

function ImportPage() {
  const upsertQueries = useStore((s) => s.upsertQueries);
  const upsertUrls = useStore((s) => s.upsertUrls);
  const applySeasonality = useStore((s) => s.applySeasonality);
  const queries = useStore((s) => s.queries);
  const urls = useStore((s) => s.urls);
  const metaEdits = useStore((s) => s.metaEdits);
  const texts = useStore((s) => s.texts);
  const setMetaEdit = useStore((s) => s.setMetaEdit);
  const setText = useStore((s) => s.setText);
  const clearAll = useStore((s) => s.clearAll);
  const [log, setLog] = useState<string[]>([]);
  const add = (m: string) => setLog((l) => [`${new Date().toLocaleTimeString()} — ${m}`, ...l].slice(0, 20));

  async function handleFile(kind: "topvisor" | "seasonality" | "netpeak", file: File) {
    try {
      const rows = await readMatrix(file);
      if (kind === "topvisor") {
        const lname = file.name.toLowerCase();
        const engineHint = /google/.test(lname)
          ? "google"
          : /yandex|яндекс/.test(lname)
          ? "yandex"
          : undefined;
        const parsed = parseTopvisorQueries(rows, { engineHint });
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

  // Единый экспорт CSV: одна строка на URL, у которого мета или текст
  // помечены статусом «В файле CSV». Незаполненные поля остаются пустыми.
  // URL нормализуется — убираем протокол и домен ggsel.net.
  const normalizeUrl = (u: string): string =>
    u.replace(/^https?:\/\/(?:www\.)?ggsel\.net/i, "") || u;

  const exportUrls = Array.from(
    new Set<string>([
      ...queries
        .map((q) => q.url)
        .filter((u): u is string => !!u && metaEdits[u]?.status === "in_csv"),
      ...Object.values(texts)
        .filter((t) => t.status === "in_csv")
        .map((t) => t.url),
    ]),
  );

  function exportCms() {
    if (!exportUrls.length) {
      toast.error("Нет данных со статусом «В файле CSV»");
      return;
    }
    const out = exportUrls.map((u) => {
      const m = metaFor(u, urls, metaEdits);
      const metaReady = metaEdits[u]?.status === "in_csv";
      const textReady = texts[u]?.status === "in_csv";
      return {
        url: normalizeUrl(u),
        title: metaReady ? (m.h1 ?? "") : "",
        seo_title: metaReady ? (m.title ?? "") : "",
        seo_desc: metaReady ? (m.description ?? "") : "",
        seo_text: textReady ? (texts[u]?.text ?? "") : "",
      };
    });
    downloadCsv(`seo-export-${Date.now()}.csv`, toCsv(out));
    const at = Date.now();
    for (const u of exportUrls) {
      if (metaEdits[u]?.status === "in_csv") setMetaEdit(u, { status: "done", updatedAt: at });
      if (texts[u]?.status === "in_csv") setText(u, { status: "done", updatedAt: at });
    }
    add(`Экспорт: ${out.length} URL → статус «Готово»`);
    toast.success(`Экспортировано ${out.length} URL, статусы обновлены`);
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
          desc="XLSX/CSV. Колонки: Запрос, Папка, Группа, URL, Частота, Google, Yandex"
          onFile={(f) => handleFile("topvisor", f)}
        />
        <ImportCard
          title="Сезонность"
          desc="CSV/XLSX. Колонки: Запрос, Янв, Фев, …, Дек"
          onFile={(f) => handleFile("seasonality", f)}
        />
        <ImportCard
          title="Netpeak Checker"
          desc="XLSX/CSV. Колонки: URL, Title, Description, H1, Длина текста"
          onFile={(f) => handleFile("netpeak", f)}
        />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Экспорт CSV для CMS</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            Поля: url, title (=H1), seo_title (=Title), seo_desc, seo_text (HTML).
            <br />
            Единый файл: строка на каждый URL со статусом <b>«В файле CSV»</b> (мета и/или текст).
            Незаполненные поля остаются пустыми. URL записывается без «https://ggsel.net».
            Сейчас к выгрузке: <b>{exportUrls.length}</b>. После скачивания статусы «В файле CSV» → «Готово».
          </div>
          <Button onClick={exportCms} disabled={!exportUrls.length}>
            Скачать CSV ({exportUrls.length})
          </Button>
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
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
        />
        <Button variant="outline" onClick={() => ref.current?.click()} className="w-full">Выбрать файл</Button>
      </CardContent>
    </Card>
  );
}
