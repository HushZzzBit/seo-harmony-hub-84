import { createFileRoute, ClientOnly, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { downloadCsv, toCsv, readMatrix, parseSeasonality } from "@/lib/csv";
import { toast } from "sonner";
import { metaFor } from "@/lib/seo";
import { Settings } from "lucide-react";
import { pullTopvisorQueries, pullXmlriverSeasonalityFn } from "@/lib/lsi.functions";

export const Route = createFileRoute("/import")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "SEO GGSEL — импорт и экспорт" },
      { name: "description", content: "Импорт данных Topvisor, расчет сезонности XMLRiver и единый экспорт CSV для SEO GGSEL." },
      { property: "og:title", content: "SEO GGSEL — импорт и экспорт" },
      { property: "og:description", content: "Импорт данных Topvisor, расчет сезонности XMLRiver и единый экспорт CSV для SEO GGSEL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => <ClientOnly fallback={null}><ImportPage /></ClientOnly>,
});

// Регионы Яндекса (geo id) — самые ходовые
const YANDEX_REGIONS: Array<{ id: string; label: string }> = [
  { id: "225", label: "Россия" },
  { id: "213", label: "Москва" },
  { id: "2", label: "Санкт-Петербург" },
  { id: "1", label: "Москва и область" },
  { id: "10174", label: "Санкт-Петербург и область" },
  { id: "54", label: "Екатеринбург" },
  { id: "65", label: "Новосибирск" },
  { id: "35", label: "Краснодар" },
  { id: "43", label: "Казань" },
  { id: "47", label: "Нижний Новгород" },
  { id: "50", label: "Ростов-на-Дону" },
  { id: "51", label: "Самара" },
  { id: "66", label: "Омск" },
  { id: "56", label: "Челябинск" },
  { id: "39", label: "Красноярск" },
  { id: "187", label: "Украина" },
  { id: "149", label: "Беларусь" },
  { id: "159", label: "Казахстан" },
];

function ImportPage() {
  const queries = useStore((s) => s.queries);
  const urls = useStore((s) => s.urls);
  const metaEdits = useStore((s) => s.metaEdits);
  const texts = useStore((s) => s.texts);
  const mergeQueriesFromPull = useStore((s) => s.mergeQueriesFromPull);
  const applySeasonality = useStore((s) => s.applySeasonality);
  const setMetaEdit = useStore((s) => s.setMetaEdit);
  const setText = useStore((s) => s.setText);
  const clearAll = useStore((s) => s.clearAll);

  const [log, setLog] = useState<string[]>([]);
  const add = (m: string) =>
    setLog((l) => [`${new Date().toLocaleTimeString()} — ${m}`, ...l].slice(0, 500));

  // ---- XmlRiver seasonality (config declared before pull so we can chain) ----
  const seasonFn = useServerFn(pullXmlriverSeasonalityFn);
  const today = new Date();
  const y = today.getFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const [device, setDevice] = useState<"phone" | "desktop" | "tablet">("phone");
  const [regions, setRegions] = useState<string>("225");
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("month");
  const [dateFrom, setDateFrom] = useState<string>(iso(new Date(y - 1, today.getMonth(), 1)));
  const [dateTo, setDateTo] = useState<string>(iso(today));
  const [seasoning, setSeasoning] = useState(false);

  async function collectSeasonality(phrases: string[]) {
    if (!phrases.length) return { ok: 0 };
    setSeasoning(true);
    try {
      const batchSize = 50;
      let done = 0, ok = 0;
      const totalMap: Record<string, number[]> = {};
      for (let i = 0; i < phrases.length; i += batchSize) {
        const batch = phrases.slice(i, i + batchSize);
        const res = await seasonFn({
          data: { phrases: batch, device, regions, groupBy, dateFrom, dateTo },
        });
        Object.assign(totalMap, res.map);
        ok += Object.keys(res.map).length;
        done += batch.length;
        if (res.errors.length) {
          res.errors.forEach((e) => add(`XMLRiver: ${e}`));
        }
        add(`Сезонность: ${done}/${phrases.length} (успех ${ok}, ошибок ${res.errors.length})`);
      }
      applySeasonality(totalMap);
      return { ok };
    } finally {
      setSeasoning(false);
    }
  }

  // ---- Topvisor pull (+ auto-seasonality) ----
  const pullFn = useServerFn(pullTopvisorQueries);
  const [pulling, setPulling] = useState(false);
  async function handlePull() {
    setPulling(true);
    try {
      const res = await pullFn();
      const { added, updated } = mergeQueriesFromPull(res.rows);
      add(
        `Топвизор: получено ${res.rows.length} фраз из ${res.projects.length} проектов. Добавлено ${added}, обновлено ${updated}.`,
      );
      if (res.errors.length) res.errors.forEach((e) => add(`Ошибка: ${e}`));

      if (res.rows.length) {
        toast.success(`Подтянуто ${res.rows.length} фраз (+${added}, ~${updated}). Запускаю сезонность…`);
        const phrases = Array.from(new Set(res.rows.map((r) => r.phrase).filter(Boolean)));
        try {
          const { ok } = await collectSeasonality(phrases);
          if (ok > 0) toast.success(`Сезонность применена к ${ok}/${phrases.length} фразам`);
          else toast.error("XMLRiver не вернул сезонность — детали в журнале");
          add(`Сезонность применена: ${ok} фраз (регион ${regions}, ${device}, ${groupBy})`);
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          add(`Ошибка сезонности: ${m}`);
          toast.error(`Сезонность: ${m}`);
        }
      } else {
        toast.error(`Топвизор вернул 0 фраз${res.errors[0] ? ` — ${res.errors[0]}` : ""}`);
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      add(`Ошибка Топвизор: ${m}`);
      toast.error(m);
    } finally {
      setPulling(false);
    }
  }

  const uniqPhrases = useMemo(() => {
    const set = new Set<string>();
    for (const q of queries) if (q.phrase) set.add(q.phrase);
    return Array.from(set);
  }, [queries]);

  async function handleSeasonality() {
    if (!uniqPhrases.length) {
      toast.error("Нет фраз. Сначала подтяните данные Топвизора.");
      return;
    }
    try {
      const { ok } = await collectSeasonality(uniqPhrases);
      if (ok > 0) toast.success(`Сезонность применена к ${ok} фразам`);
      else toast.error("XMLRiver не вернул сезонность — детали в журнале");
      add(`Сезонность применена: ${ok} фраз (регион ${regions}, ${device}, ${groupBy})`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      add(`Ошибка сезонности: ${m}`);
      toast.error(m);
    }
  }

  // ---- Export ----
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
    toast.success(`Экспортировано ${out.length} URL`);
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Импорт / Экспорт</h1>
        <p className="text-sm text-muted-foreground">
          Загрузка данных из Топвизора и сезонности из Яндекс.Вордстат (xmlriver), экспорт CSV для CMS
        </p>
      </div>

      {/* --- Топвизор pull --- */}
      <Card className="mb-6">
        <CardHeader><CardTitle>Данные Топвизора</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground max-w-2xl">
            Подтягивает все фразы из проектов Топвизора, настроенных в разделе «Настройки → API и Ключи»
            (глобальный и/или пер-стрим project_id). Папка берётся из поля group_folder_path,
            группа — из group_name, как в ручной выгрузке Топвизора.
            Частотность, релевантные URL и позиции Google/Яндекс обновляются из API; сезонность сохраняется до отдельной загрузки.
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/prompts" search={{ tab: "apikeys" }}>
                <Settings className="h-4 w-4 mr-1.5" /> Настройки проекта
              </Link>
            </Button>
            <Button onClick={handlePull} disabled={pulling}>
              {pulling ? "Загружается…" : "Подтянуть данные"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* --- Сезонность xmlriver --- */}
      <Card className="mb-6">
        <CardHeader><CardTitle>Сезонность (xmlriver Wordstat New)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="text-xs text-muted-foreground">
            Поля соответствуют параметрам API <code>xmlriver.com/wordstat/new/json</code>:{" "}
            <code>user</code>, <code>key</code> — из «Настройки → API и Ключи»;{" "}
            <code>pagetype=history</code>; <code>query</code> — фраза из подтянутых данных Топвизора.
            Ниже задаются <code>device</code>, <code>regions</code>, <code>period</code>, <code>start</code>, <code>end</code>.
            Ошибки API пишутся в журнал ниже.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div>
              <Label className="text-xs mb-1 block">device (устройство)</Label>
              <Select value={device} onValueChange={(v) => setDevice(v as typeof device)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="phone">phone (смартфон)</SelectItem>
                  <SelectItem value="tablet">tablet (планшет)</SelectItem>
                  <SelectItem value="desktop">desktop (десктоп)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">regions (Яндекс geo id)</Label>
              <Select value={regions} onValueChange={setRegions}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {YANDEX_REGIONS.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.label} ({r.id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">period (группировка)</Label>
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="month">month</SelectItem>
                  <SelectItem value="week">week</SelectItem>
                  <SelectItem value="day">day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs mb-1 block">start (дд.мм.гггг)</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs mb-1 block">end (дд.мм.гггг)</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Уникальных фраз для расчёта: <b>{uniqPhrases.length}</b>.
              Для <code>period=month</code> период должен быть минимум 3 месяца и укладываться в завершённые месяцы —
              иначе XMLRiver вернёт урезанный набор точек и пустые месяцы останутся с 0.
            </div>
            <Button onClick={handleSeasonality} disabled={seasoning || !uniqPhrases.length}>
              {seasoning ? "Считаем…" : "Обновить сезонность"}
            </Button>
          </div>

          <div className="border-t pt-4">
            <Label className="text-xs mb-1 block">Ручная загрузка файла сезонности (CSV/XLSX)</Label>
            <div className="flex items-center gap-3">
              <Input
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  try {
                    const m = await readMatrix(f);
                    const map = parseSeasonality(m);
                    const n = Object.keys(map).length;
                    if (!n) {
                      toast.error("В файле не найдено фраз/месячных колонок");
                    } else {
                      applySeasonality(map);
                      add(`Ручная сезонность: применено ${n} фраз из ${f.name}`);
                      toast.success(`Применена сезонность к ${n} фразам`);
                    }
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    add(`Ошибка чтения файла: ${msg}`);
                    toast.error(msg);
                  } finally {
                    e.target.value = "";
                  }
                }}
                className="max-w-md"
              />
              <div className="text-xs text-muted-foreground">
                Формат: первая колонка — фраза, остальные — даты (месяцы). Значения усредняются по месяцу.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* --- Экспорт --- */}
      <Card className="mb-6">
        <CardHeader><CardTitle>Экспорт CSV для CMS</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            Поля: url, title (=H1), seo_title (=Title), seo_desc, seo_text (HTML).
            Один файл: строка на каждый URL со статусом <b>«В файле CSV»</b> (мета и/или текст).
            URL записывается без «https://ggsel.net». Сейчас к выгрузке: <b>{exportUrls.length}</b>.
            После скачивания статусы «В файле CSV» → «Готово».
          </div>
          <Button onClick={exportCms} disabled={!exportUrls.length}>
            Скачать CSV ({exportUrls.length})
          </Button>
        </CardContent>
      </Card>

      {/* --- Storage state --- */}
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
            onClick={() => {
              if (confirm("Удалить все данные?")) {
                clearAll();
                toast.success("Очищено");
              }
            }}
          >
            Очистить всё
          </Button>
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
