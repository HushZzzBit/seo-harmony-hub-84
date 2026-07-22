import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/store";
import {
  extractWords,
  groupSeasonality,
  metaFor,
  MONTHS,
  priorityForGroup,
  recommendedMonth,
  tokenize,
} from "@/lib/seo";
import type { MetaSource, Priority, Query, Status } from "@/lib/types";
import { AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, Sparkles, Loader2 } from "lucide-react";
import { VariableHint } from "@/components/VariableHint";
import { RoundCheckbox } from "@/components/RoundCheckbox";
import { generateMeta } from "@/lib/openai.functions";
import { resolvePrompt } from "@/routes/prompts";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { metaStatusLabel, posColor, priorityLabel, priorityRank, priorityStyle } from "@/lib/ui";

export const Route = createFileRoute("/meta")({
  ssr: false,
  component: () => (
    <ClientOnly fallback={null}>
      <MetaPage />
    </ClientOnly>
  ),
});

type Row = { folder: string; group: string; url: string; qs: Query[] };
type SortKey = "priority" | "season" | "coverage" | "freq" | "status" | "url";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

function MetaPage() {
  const queries = useStore((s) => s.queries);
  const urls = useStore((s) => s.urls);
  const metaEdits = useStore((s) => s.metaEdits);
  const setMetaEdit = useStore((s) => s.setMetaEdit);
  const setMetaEditsBulk = useStore((s) => s.setMetaEditsBulk);
  const prompts = useStore((s) => s.prompts);
  const [folder, setFolder] = useState<string>("all");
  const [group, setGroup] = useState<string>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<Status | "">("");
  const [viewMode, setViewMode] = useState<"compact" | "expanded">("compact");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = useCallback((url: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });
  }, []);

  const [bulkGenerating, setBulkGenerating] = useState(false);
  const generateMetaFn = useServerFn(generateMeta);

  const handleToggleSelect = useCallback((url: string, v: boolean) => {
    if (!url) return;
    setSelected((prev) => {
      const n = new Set(prev);
      if (v) n.add(url);
      else n.delete(url);
      return n;
    });
  }, []);

  const folders = useMemo(
    () => Array.from(new Set(queries.map((q) => q.folder))).sort(),
    [queries],
  );

  const groups = useMemo(
    () =>
      Array.from(
        new Set(
          queries
            .filter((q) => folder === "all" || q.folder === folder)
            .map((q) => q.group),
        ),
      ).sort(),
    [queries, folder],
  );

  const rows = useMemo(() => {
    const byUrl = new Map<string, Row>();
    for (const q of queries) {
      const key = q.url ?? `~${q.folder}/${q.group}`;
      if (!byUrl.has(key))
        byUrl.set(key, { folder: q.folder, group: q.group, url: q.url ?? "", qs: [] });
      byUrl.get(key)!.qs.push(q);
    }
    const now = new Date().getMonth();
    const enriched = Array.from(byUrl.values())
      .filter((r) => {
        if (folder !== "all" && r.folder !== folder) return false;
        if (group !== "all" && r.group !== group) return false;
        if (
          deferredSearch &&
          !(r.url + r.group + r.folder).toLowerCase().includes(deferredSearch.toLowerCase())
        )
          return false;
        const st = metaEdits[r.url]?.status ?? "not_started";
        if (statusFilter !== "all" && st !== statusFilter) return false;
        return true;
      })
      .map((r) => {
        const seasonality = groupSeasonality(r.qs);
        const prio = priorityForGroup(seasonality);
        const rec = recommendedMonth(seasonality);
        const dist = (rec - now + 12) % 12;
        const freq = r.qs.reduce((a, q) => a + (q.frequency || 0), 0);
        // Coverage is expensive; only compute when needed for sort. Otherwise MetaRow computes locally.
        let coverage = 0;
        if (sortKey === "coverage") {
          const m = metaFor(r.url, urls, metaEdits);
          const words = extractWords(r.qs.map((q) => q.phrase));
          const wordSet = new Set(words.map((w) => w.word));
          const used = new Set<string>();
          for (const t of [m.title, m.description, m.h1])
            for (const w of tokenize(t)) if (wordSet.has(w)) used.add(w);
          coverage = wordSet.size ? Math.round((used.size / wordSet.size) * 100) : 0;
        }
        const status: Status = metaEdits[r.url]?.status ?? "not_started";
        return { r, seasonality, prio, rec, dist, freq, coverage, status };
      })
      .filter((e) => priorityFilter === "all" || e.prio === priorityFilter);

    const dir = sortDir === "asc" ? 1 : -1;
    enriched.sort((a, b) => {
      switch (sortKey) {
        case "priority": {
          const d = priorityRank[a.prio] - priorityRank[b.prio];
          return (d !== 0 ? d : a.dist - b.dist) * dir;
        }
        case "season":
          return (a.dist - b.dist) * dir;
        case "coverage":
          return (a.coverage - b.coverage) * dir;
        case "freq":
          return (a.freq - b.freq) * dir;
        case "status":
          return a.status.localeCompare(b.status) * dir;
        case "url":
          return (a.r.folder + a.r.group + a.r.url).localeCompare(
            b.r.folder + b.r.group + b.r.url,
          ) * dir;
      }
    });
    return enriched;
  }, [queries, folder, group, deferredSearch, statusFilter, priorityFilter, metaEdits, urls, sortKey, sortDir]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [folder, group, deferredSearch, statusFilter, priorityFilter, sortKey, sortDir]);

  const visible = rows.slice(0, limit);
  const hasMore = rows.length > visible.length;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("asc");
    }
  };

  const sortLabel: Record<SortKey, string> = {
    priority: "Приоритет",
    season: "Сезонность",
    coverage: "Покрытие",
    freq: "Частота",
    status: "Статус",
    url: "URL",
  };

  return (
    <AppShell>
      <div className="flex items-end justify-between mb-4 gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">Meta Tags</h1>
            <VariableHint />
          </div>
          <p className="text-sm text-muted-foreground">
            Инлайн-редактирование с подсветкой ключевых слов
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="Поиск"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56 h-9"
          />
          <Select
            value={folder}
            onValueChange={(v) => {
              setFolder(v);
              setGroup("all");
            }}
          >
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все папки</SelectItem>
              {folders.map((f) => (<SelectItem key={f} value={f}>{f}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все группы</SelectItem>
              {groups.map((g) => (<SelectItem key={g} value={g}>{g}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все приоритеты</SelectItem>
              <SelectItem value="high">Высокий</SelectItem>
              <SelectItem value="medium">Средний</SelectItem>
              <SelectItem value="low">Низкий</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(metaStatusLabel).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1 rounded-md border border-border h-9 px-1">
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
              <SelectTrigger className="h-7 border-0 shadow-none text-xs w-32 px-2">
                <ArrowUpDown className="h-3 w-3 mr-1 opacity-60" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(sortLabel).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => toggleSort(sortKey)}
              className="h-7 px-1.5 rounded hover:bg-accent"
              title={sortDir === "asc" ? "По возрастанию" : "По убыванию"}
            >
              {sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="flex items-center gap-0.5 rounded-md border border-border h-9 px-1">
            <button
              type="button"
              onClick={() => setViewMode("compact")}
              className={
                "h-7 px-2 text-xs rounded transition " +
                (viewMode === "compact" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")
              }
              title="Компактный список"
            >Список</button>
            <button
              type="button"
              onClick={() => setViewMode("expanded")}
              className={
                "h-7 px-2 text-xs rounded transition " +
                (viewMode === "expanded" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")
              }
              title="Все карточки развёрнуты"
            >Карточки</button>
          </div>
        </div>
      </div>

      {(() => {
        const visibleUrls = visible.map((e) => e.r.url).filter(Boolean);
        const selCount = visibleUrls.filter((u) => selected.has(u)).length;
        return (
          <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-muted/30">
            <RoundCheckbox
              aria-label="Выбрать все"
              checked={visibleUrls.length > 0 && selCount === visibleUrls.length}
              indeterminate={selCount > 0 && selCount < visibleUrls.length}
              onChange={() => {
                setSelected((prev) => {
                  const n = new Set(prev);
                  if (selCount > 0) visibleUrls.forEach((u) => n.delete(u));
                  else visibleUrls.forEach((u) => n.add(u));
                  return n;
                });
              }}
            />
            <span className="text-sm text-muted-foreground">
              Выбрано: <span className="font-medium text-foreground">{selected.size}</span>
            </span>
            <div className="flex items-center gap-2 ml-auto">
              <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as Status)}>
                <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Изменить статус на…" /></SelectTrigger>
                <SelectContent>
                  {Object.entries(metaStatusLabel).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                disabled={selected.size === 0 || !bulkStatus}
                onClick={() => {
                  if (!bulkStatus) return;
                  setMetaEditsBulk(Array.from(selected), { status: bulkStatus as Status });
                  setSelected(new Set());
                  setBulkStatus("");
                }}
                className="h-8 px-3 text-xs rounded-md bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition"
              >Применить</button>
              <button
                type="button"
                disabled={selected.size === 0 || bulkGenerating}
                onClick={async () => {
                  const targetUrls = Array.from(selected).filter(Boolean);
                  if (targetUrls.length === 0) return;
                  setBulkGenerating(true);
                  const byUrl = new Map(rows.map((e) => [e.r.url, e.r] as const));
                  let ok = 0;
                  let fail = 0;
                  for (const u of targetUrls) {
                    const r = byUrl.get(u);
                    if (!r) { fail++; continue; }
                     try {
                       const p = resolvePrompt(prompts, r.folder);
                       const result = await generateMetaFn({
                         data: {
                           url: r.url,
                           folder: r.folder,
                           group: r.group,
                           phrases: r.qs.map((q) => ({
                             phrase: q.phrase,
                             frequency: q.frequency,
                             googlePosition: q.googlePosition,
                             yandexPosition: q.yandexPosition,
                           })),
                           currentTitle: (metaEdits[u]?.title ?? urls[u]?.title) || undefined,
                           systemPrompt: p.systemPrompt,
                           promptTemplate: p.userPrompt,
                           model: p.model,
                         },
                       });
                       setMetaEdit(u, {
                         title: result.title,
                         description: result.description,
                         h1: result.h1,
                         source: "ai",
                       });
                      ok++;
                    } catch (e) {
                      console.error(e);
                      fail++;
                    }
                  }
                  setBulkGenerating(false);
                  toast[fail === 0 ? "success" : "warning"](
                    `AI: сгенерировано ${ok}${fail ? `, ошибок: ${fail}` : ""}`,
                  );
                }}
                className="h-8 px-3 text-xs rounded-md border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40 transition inline-flex items-center gap-1"
                title="Сгенерировать мета-теги через AI для выбранных"
              >
                {bulkGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                AI генерация
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
                className="h-8 px-2 text-xs rounded-md hover:bg-accent transition disabled:opacity-40"
              >Снять выбор</button>
            </div>
          </div>
        );
      })()}

      <div className="space-y-2">
        {visible.map((e) => (
          <MetaRow
            key={e.r.url || e.r.folder + e.r.group}
            row={e.r}
            prio={e.prio}
            rec={e.rec}
            freq={e.freq}
            seasonality={e.seasonality}
            selected={!!e.r.url && selected.has(e.r.url)}
            onToggleSelect={handleToggleSelect}
            open={viewMode === "expanded" || (!!e.r.url && expanded.has(e.r.url))}
            onToggleOpen={() => e.r.url && toggleExpanded(e.r.url)}
          />
        ))}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              Нет строк. Загрузите данные во вкладке Import.
            </CardContent>
          </Card>
        )}
        {hasMore && (
          <div className="flex justify-center py-3">
            <button
              type="button"
              onClick={() => setLimit((n) => n + PAGE_SIZE)}
              className="text-xs px-4 py-2 rounded-lg border border-border hover:bg-accent transition"
            >
              Показать ещё {Math.min(PAGE_SIZE, rows.length - visible.length)} из {rows.length - visible.length}
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <div className="text-center text-[11px] text-muted-foreground py-1">
            Показано {visible.length} из {rows.length}
          </div>
        )}
      </div>
    </AppShell>
  );
}

const MetaRow = memo(function MetaRow({
  row,
  prio,
  rec,
  freq,
  seasonality,
  selected,
  onToggleSelect,
  open,
  onToggleOpen,
}: {
  row: Row;
  prio: Priority;
  rec: number;
  freq: number;
  seasonality: number[];
  selected: boolean;
  onToggleSelect: (url: string, v: boolean) => void;
  open: boolean;
  onToggleOpen: () => void;
}) {
  // Row-scoped selectors — this row only re-renders when its own data changes.
  const urlRow = useStore((s) => s.urls[row.url]);
  const metaEdit = useStore((s) => s.metaEdits[row.url]);
  const setMetaEdit = useStore((s) => s.setMetaEdit);
  const m = useMemo(
    () => metaFor(row.url, urlRow ? { [row.url]: urlRow } : {}, metaEdit ? { [row.url]: metaEdit } : {}),
    [row.url, urlRow, metaEdit],
  );


  const words = useMemo(() => extractWords(row.qs.map((q) => q.phrase)), [row.qs]);
  const wordSet = useMemo(() => new Set(words.map((w) => w.word)), [words]);

  const [title, setTitle] = useState(m.title);
  const [desc, setDesc] = useState(m.description);
  const [h1, setH1] = useState(m.h1);
  
  const status: Status = metaEdit?.status ?? "not_started";
  const [generating, setGenerating] = useState(false);
  const generateMetaFn = useServerFn(generateMeta);
  const folderPrompts = useStore((s) => s.prompts);

  async function runAi() {
    if (!row.url) return;
    setGenerating(true);
    try {
      const p = resolvePrompt(folderPrompts, row.folder);
      const result = await generateMetaFn({
        data: {
          url: row.url,
          folder: row.folder,
          group: row.group,
          phrases: row.qs.map((q) => ({
            phrase: q.phrase,
            frequency: q.frequency,
            googlePosition: q.googlePosition,
            yandexPosition: q.yandexPosition,
          })),
          currentTitle: title || undefined,
          currentDescription: desc || undefined,
          currentH1: h1 || undefined,
          systemPrompt: p.systemPrompt,
          promptTemplate: p.userPrompt,
          model: p.model,
        },
      });
      setTitle(result.title);
      setDesc(result.description);
      setH1(result.h1);
      setMetaEdit(row.url, {
        title: result.title,
        description: result.description,
        h1: result.h1,
        source: "ai",
      });
      toast.success("Мета-теги сгенерированы");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Ошибка генерации";
      toast.error(msg);
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    setTitle(m.title);
    setDesc(m.description);
    setH1(m.h1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.title, m.description, m.h1]);

  const avgPos = (key: "googlePosition" | "yandexPosition") => {
    const vals = row.qs.map((q) => q[key]).filter((v): v is number => typeof v === "number" && v > 0);
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  };
  const gPos = avgPos("googlePosition");
  const yPos = avgPos("yandexPosition");
  const posColor = (p: number) =>
    !p ? "text-muted-foreground" : p <= 10 ? "text-chart-2" : p <= 30 ? "text-chart-4" : "text-destructive";

  const usedAll = useMemo(() => {
    const s = new Set<string>();
    for (const t of [title, desc, h1])
      for (const w of tokenize(t)) if (wordSet.has(w)) s.add(w);
    return s;
  }, [title, desc, h1, wordSet]);

  const coverage = wordSet.size ? Math.round((usedAll.size / wordSet.size) * 100) : 0;

  function save(patch: { title?: string; description?: string; h1?: string; status?: Status }) {
    if (!row.url) return;
    setMetaEdit(row.url, patch);
  }

  const source: MetaSource = metaEdit?.source ?? "manual";
  const sourceLabel: Record<MetaSource, string> = {
    ai: "АИ",
    manual: "Руч",
    "ai+manual": "АИ + Руч",
  };
  const sourceStyle: Record<MetaSource, string> = {
    ai: "bg-primary/15 text-primary border-primary/30",
    manual: "bg-muted text-muted-foreground border-border",
    "ai+manual": "bg-chart-1/15 text-chart-1 border-chart-1/30",
  };

  const statusRing =
    status === "done"
      ? "border-l-chart-2"
      : status === "in_csv"
        ? "border-l-chart-1"
        : status === "in_progress"
          ? "border-l-chart-4"
          : "border-l-border";

  const prioStyle =
    prio === "high"
      ? "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30"
      : prio === "medium"
        ? "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30"
        : "bg-muted text-muted-foreground border-border";

  return (
    <Card className={`border-l-4 ${statusRing} ${selected ? "bg-primary/5" : ""}`}>
      <CardContent className="p-3">
        {/* Compact header — always visible */}
        <div className="flex items-center gap-2">
          <RoundCheckbox
            aria-label="Выбрать"
            disabled={!row.url}
            checked={selected}
            onChange={(v) => onToggleSelect(row.url, v)}
          />
          <button
            type="button"
            onClick={onToggleOpen}
            className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded hover:bg-accent text-muted-foreground"
            title={open ? "Свернуть" : "Развернуть"}
            aria-label={open ? "Свернуть" : "Развернуть"}
          >
            <ArrowDown className={"h-3.5 w-3.5 transition-transform " + (open ? "" : "-rotate-90")} />
          </button>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${prioStyle}`}>
            {priorityLabel[prio]}
          </span>
          <div className="min-w-0 flex-1 cursor-pointer" onClick={onToggleOpen}>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
              <span className="truncate">{row.folder} · {row.group}</span>
              <KeywordsTooltip qs={row.qs} />
            </div>
            <div className="text-xs font-mono text-foreground/80 truncate" title={row.url}>
              {row.url || "—"}
            </div>
          </div>

          {/* Inline metrics — always visible for daily SEO scan */}
          <div className="hidden md:flex items-center gap-3 text-[11px] text-muted-foreground shrink-0">
            <MiniSpark values={seasonality} peakMonth={rec} />
            <span title="Суммарная частота" className="tabular-nums">
              <span className="opacity-60 mr-0.5">f</span>
              <span className="text-foreground">{freq || "—"}</span>
            </span>
            <span title="Средняя позиция Google" className="tabular-nums">
              <span className="opacity-60 mr-0.5">G</span>
              <span className={posColor(gPos)}>{gPos || "—"}</span>
            </span>
            <span title="Средняя позиция Яндекс" className="tabular-nums">
              <span className="opacity-60 mr-0.5">Я</span>
              <span className={posColor(yPos)}>{yPos || "—"}</span>
            </span>
            <span title="Рекомендованный месяц" className="text-foreground">{MONTHS[rec]}</span>
            <span
              className={
                "tabular-nums " +
                (coverage >= 70 ? "text-chart-2" : coverage >= 40 ? "text-chart-4" : "text-muted-foreground")
              }
              title={`Покрытие ключей ${usedAll.size}/${wordSet.size}`}
            >
              {coverage}%
            </span>
          </div>

          <button
            type="button"
            onClick={runAi}
            disabled={generating || !row.url}
            title="Сгенерировать мета-теги через AI"
            className="h-7 px-2 shrink-0 rounded-md border border-primary/40 text-primary text-xs inline-flex items-center gap-1 hover:bg-primary/10 disabled:opacity-40 transition"
          >
            {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            AI
          </button>
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border shrink-0 ${sourceStyle[source]}`}
            title={source === "ai" ? "Сгенерировано AI" : source === "ai+manual" ? "AI + ручная правка" : "Написано вручную"}
          >
            {sourceLabel[source]}
          </span>
          <Select value={status} onValueChange={(v) => save({ status: v as Status })}>
            <SelectTrigger className="h-7 text-xs w-36 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_started">Не начато</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="in_csv">В файле CSV</SelectItem>
              <SelectItem value="done">Готово</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {open && (
          <>
            {/* Mobile metrics row (hidden on md+ because shown inline above) */}
            <div className="md:hidden flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mt-2 text-muted-foreground">
              <span>Частота: <span className="tabular-nums text-foreground">{freq || "—"}</span></span>
              <span>G: <span className={"tabular-nums " + posColor(gPos)}>{gPos || "—"}</span></span>
              <span>Я: <span className={"tabular-nums " + posColor(yPos)}>{yPos || "—"}</span></span>
              <span>Рек. месяц: <span className="text-foreground">{MONTHS[rec]}</span></span>
              <span>Ключей: <span className="tabular-nums text-foreground">{usedAll.size}/{wordSet.size}</span></span>
            </div>

            {/* Two-column: editor (work area) | preview (result) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">
              <div className="rounded-md border border-border bg-background/40 p-2 space-y-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-1 pb-0.5">
                  Редактирование
                </div>
                <Field label="H1">
                  <EditableCell value={h1} onChange={setH1} onCommit={(v) => save({ h1: v })} words={wordSet} />
                </Field>
                <Field label="Title" hint={`${title.length}/60`} over={title.length > 60}>
                  <EditableCell value={title} onChange={setTitle} onCommit={(v) => save({ title: v })} words={wordSet} maxLen={60} />
                </Field>
                <Field label="Description" hint={`${desc.length}/160`} over={desc.length > 160}>
                  <EditableCell value={desc} onChange={setDesc} onCommit={(v) => save({ description: v })} words={wordSet} rows={2} maxLen={160} />
                </Field>
              </div>
              <MetaPreview
                title={title}
                desc={desc}
                h1={h1}
                words={words}
                used={usedAll}
                coverage={coverage}
                qs={row.qs}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
});

function MiniSpark({ values, peakMonth: peak }: { values: number[]; peakMonth: number }) {
  const max = Math.max(1, ...values);
  const now = new Date().getMonth();
  const W = 84;
  const H = 22;
  const bw = W / 12;
  return (
    <svg width={W} height={H} className="shrink-0" aria-label="Сезонность">
      {values.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * (H - 2)));
        const fill =
          i === peak
            ? "var(--chart-1)"
            : i === now
              ? "var(--chart-4)"
              : "var(--muted-foreground)";
        const opacity = i === peak || i === now ? 0.95 : 0.35;
        return (
          <rect
            key={i}
            x={i * bw + 0.5}
            y={H - h}
            width={bw - 1}
            height={h}
            fill={fill}
            opacity={opacity}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

function KeywordsTooltip({ qs }: { qs: Query[] }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-full p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition"
            aria-label="Ключевые слова"
          >
            <AlertCircle className="h-3 w-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-[340px] bg-popover text-popover-foreground border border-border shadow-lg px-3 py-2"
        >
          <div className="text-xs font-semibold mb-1.5 text-foreground">
            Ключевые слова ({qs.length})
          </div>
          <div className="space-y-0.5">
            {qs.map((q) => (
              <div key={q.id} className="flex gap-3 text-[11px] leading-snug">
                <span className="font-medium shrink-0 min-w-[80px] max-w-[160px] truncate" title={q.phrase}>
                  {q.phrase}
                </span>
                <span className="tabular-nums text-muted-foreground shrink-0">
                  {q.frequency || "—"}
                </span>
                {typeof q.googlePosition === "number" && (
                  <span className="tabular-nums text-muted-foreground shrink-0">
                    G:{q.googlePosition}
                  </span>
                )}
                {typeof q.yandexPosition === "number" && (
                  <span className="tabular-nums text-muted-foreground shrink-0">
                    Я:{q.yandexPosition}
                  </span>
                )}
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
function PhrasesPanel({ qs, texts }: { qs: Query[]; texts: string[] }) {
  const sorted = useMemo(
    () => [...qs].sort((a, b) => (b.frequency || 0) - (a.frequency || 0)),
    [qs],
  );
  const combined = useMemo(() => texts.join(" \n ").toLowerCase().replace(/ё/g, "е"), [texts]);
  const isUsed = (phrase: string) => {
    const toks = phrase.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i).filter((w) => w.length > 2);
    if (!toks.length) return false;
    return toks.every((t) => combined.includes(t));
  };
  const posColor = (p?: number) =>
    !p ? "text-muted-foreground" : p <= 10 ? "text-chart-2" : p <= 30 ? "text-chart-4" : "text-destructive";
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2 text-xs max-h-[240px] overflow-auto">
      <div className="flex items-center justify-between mb-1.5 sticky top-0 bg-muted/40 backdrop-blur -mx-2 px-2 py-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Ключевые фразы
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">{qs.length}</span>
      </div>
      {sorted.length === 0 && (
        <div className="text-muted-foreground text-[11px]">Нет фраз</div>
      )}
      <div className="space-y-0.5">
        {sorted.map((q) => {
          const used = isUsed(q.phrase);
          return (
            <div
              key={q.id}
              className={
                "flex items-center gap-2 text-[11px] leading-snug rounded px-1 py-0.5 " +
                (used ? "bg-chart-2/10" : "hover:bg-accent/40")
              }
              title={q.phrase}
            >
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(q.phrase)}
                className={
                  "flex-1 min-w-0 truncate text-left " +
                  (used ? "text-foreground" : "text-foreground/80")
                }
                title="Скопировать фразу"
              >
                {q.phrase}
              </button>
              {q.frequency ? (
                <span className="tabular-nums text-muted-foreground shrink-0" title="Частота">
                  {q.frequency}
                </span>
              ) : null}
              {typeof q.googlePosition === "number" && q.googlePosition > 0 && (
                <span className={"tabular-nums shrink-0 " + posColor(q.googlePosition)} title="Google">
                  G{q.googlePosition}
                </span>
              )}
              {typeof q.yandexPosition === "number" && q.yandexPosition > 0 && (
                <span className={"tabular-nums shrink-0 " + posColor(q.yandexPosition)} title="Яндекс">
                  Я{q.yandexPosition}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function highlightHtml(text: string, words: Set<string>) {
  if (!text) return "";
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
  return escape(text).replace(/([a-zа-я0-9]+)/gi, (m) => {
    const norm = m.toLowerCase().replace(/ё/g, "е");
    return words.has(norm) ? `<mark>${m}</mark>` : m;
  });
}

function MetaPreview({
  title,
  desc,
  h1,
  words,
  used,
  coverage,
  qs,
}: {
  title: string;
  desc: string;
  h1: string;
  words: { word: string; count: number }[];
  used: Set<string>;
  coverage: number;
  qs: Query[];
}) {
  const [tab, setTab] = useState<"preview" | "keys" | "phrases">("preview");
  const wordSet = useMemo(() => new Set(words.map((w) => w.word)), [words]);
  const covColor =
    coverage >= 70 ? "text-chart-2" : coverage >= 40 ? "text-chart-4" : "text-muted-foreground";
  const tabBtn = (k: typeof tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      className={
        "px-2 py-0.5 rounded text-[10px] uppercase tracking-wide transition " +
        (tab === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );
  const combined = useMemo(
    () => [title, desc, h1].join(" \n ").toLowerCase().replace(/ё/g, "е"),
    [title, desc, h1],
  );
  const phrasesUsed = useMemo(() => {
    let n = 0;
    for (const q of qs) {
      const toks = q.phrase.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i).filter((w) => w.length > 2);
      if (toks.length && toks.every((t) => combined.includes(t))) n++;
    }
    return n;
  }, [qs, combined]);
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2 flex flex-col min-w-0">
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
          {tabBtn("preview", "Итог")}
          {tabBtn("keys", `Слова ${used.size}/${wordSet.size}`)}
          {tabBtn("phrases", `Фразы ${phrasesUsed}/${qs.length}`)}
        </div>
        <span className={"text-[11px] tabular-nums shrink-0 " + covColor} title="Покрытие ключевых слов">
          {coverage}%
        </span>
      </div>
      {tab === "preview" && (
        <div className="kw-preview space-y-2 px-1 py-1 text-sm text-foreground/90">
          {(["H1", "Title", "Description"] as const).map((label, i) => {
            const value = [h1, title, desc][i];
            return (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">{label}</div>
                <div
                  className="text-sm leading-snug"
                  dangerouslySetInnerHTML={{
                    __html:
                      highlightHtml(value, wordSet) ||
                      '<span class="text-muted-foreground italic">пусто</span>',
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      {tab === "keys" && <KeywordsPanel words={words} used={used} />}
      {tab === "phrases" && <PhrasesPanel qs={qs} texts={[title, desc, h1]} />}
    </div>
  );
}



function Field({
  label,
  hint,
  over,
  children,
}: {
  label: string;
  hint?: string;
  over?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 items-start">
      <div className="w-20 shrink-0 pt-1.5">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
        {hint && (
          <div className={"text-[10px] tabular-nums " + (over ? "text-destructive" : "text-muted-foreground/70")}>
            {hint}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function KeywordsPanel({
  words,
  used,
}: {
  words: { word: string; count: number }[];
  used: Set<string>;
}) {
  const missing = words.filter((w) => !used.has(w.word));
  const hits = words.filter((w) => used.has(w.word));
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2 text-xs max-h-[180px] overflow-auto">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Ключевые слова
        </span>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {hits.length}/{words.length}
        </span>
      </div>
      {missing.length > 0 && (
        <div className="mb-1.5">
          <div className="text-[10px] text-muted-foreground mb-1">Не хватает</div>
          <div className="flex flex-wrap gap-1">
            {missing.map((w) => (
              <span
                key={w.word}
                className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive text-[11px]"
                title={`встречается в ${w.count} запросах`}
              >
                {w.word}
                {w.count > 1 && <span className="ml-1 opacity-60">·{w.count}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {hits.length > 0 && (
        <div>
          <div className="text-[10px] text-muted-foreground mb-1">Есть</div>
          <div className="flex flex-wrap gap-1">
            {hits.map((w) => (
              <span
                key={w.word}
                className="px-1.5 py-0.5 rounded bg-chart-2/15 text-chart-2 text-[11px]"
              >
                {w.word}
              </span>
            ))}
          </div>
        </div>
      )}
      {words.length === 0 && (
        <div className="text-muted-foreground text-[11px]">Нет запросов</div>
      )}
    </div>
  );
}

function EditableCell({
  value,
  onChange,
  onCommit,
  words,
  rows = 1,
}: {
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  words: Set<string>;
  maxLen?: number;
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const autosize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  };
  useEffect(() => {
    autosize();
  }, [value]);

  return (
    <div>
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        className="w-full resize-none bg-transparent text-sm leading-snug rounded px-2 py-1.5 border border-border/50 hover:border-border focus:border-ring focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        spellCheck={false}
      />
    </div>
  );
}

function Highlighted({ text, words }: { text: string; words: Set<string> }) {
  const seen = new Map<string, number>();
  const parts = text.split(/(\s+)/);
  return (
    <span className="text-muted-foreground/70">
      {parts.map((p, i) => {
        const norm = p.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/gi, "");
        if (!norm) return <span key={i}>{p}</span>;
        if (!words.has(norm)) return <span key={i}>{p}</span>;
        const count = (seen.get(norm) ?? 0) + 1;
        seen.set(norm, count);
        return (
          <span
            key={i}
            className={
              count > 1
                ? "bg-chart-4/50 rounded px-0.5 text-foreground"
                : "bg-chart-2/40 rounded px-0.5 text-foreground"
            }
          >
            {p}
          </span>
        );
      })}
    </span>
  );
}
