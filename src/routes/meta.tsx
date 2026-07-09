import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { Priority, Query, Status } from "@/lib/types";
import { AlertCircle, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from "lucide-react";
import { VariableHint } from "@/components/VariableHint";
import { RoundCheckbox } from "@/components/RoundCheckbox";

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

const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
const priorityLabel: Record<Priority, string> = { high: "Высокий", medium: "Средний", low: "Низкий" };

const PAGE_SIZE = 50;

function MetaPage() {
  const queries = useStore((s) => s.queries);
  const urls = useStore((s) => s.urls);
  const metaEdits = useStore((s) => s.metaEdits);
  const setMetaEdit = useStore((s) => s.setMetaEdit);
  const [folder, setFolder] = useState<string>("all");
  const [group, setGroup] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<Status | "">("");

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
          search &&
          !(r.url + r.group + r.folder).toLowerCase().includes(search.toLowerCase())
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
  }, [queries, folder, group, search, statusFilter, priorityFilter, metaEdits, urls, sortKey, sortDir]);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [folder, group, search, statusFilter, priorityFilter, sortKey, sortDir]);

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
              <SelectItem value="not_started">Не начато</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="in_csv">В файле CSV</SelectItem>
              <SelectItem value="done">Готово</SelectItem>
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
                  <SelectItem value="not_started">Не начато</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="in_csv">В файле CSV</SelectItem>
                  <SelectItem value="done">Готово</SelectItem>
                </SelectContent>
              </Select>
              <button
                type="button"
                disabled={selected.size === 0 || !bulkStatus}
                onClick={() => {
                  if (!bulkStatus) return;
                  for (const u of selected) setMetaEdit(u, { status: bulkStatus as Status });
                  setSelected(new Set());
                  setBulkStatus("");
                }}
                className="h-8 px-3 text-xs rounded-md bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition"
              >Применить</button>
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
            selected={!!e.r.url && selected.has(e.r.url)}
            onToggleSelect={handleToggleSelect}
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
  selected,
  onToggleSelect,
}: {
  row: Row;
  prio: Priority;
  rec: number;
  freq: number;
  selected: boolean;
  onToggleSelect: (url: string, v: boolean) => void;
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
  const [expanded, setExpanded] = useState(false);
  const status: Status = metaEdit?.status ?? "not_started";

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
        {/* Compact header */}
        <div className="flex items-center gap-2 mb-2">
          <RoundCheckbox
            aria-label="Выбрать"
            disabled={!row.url}
            checked={selected}
            onChange={(v) => onToggleSelect(row.url, v)}
          />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground shrink-0"
            title={expanded ? "Скрыть детали" : "Показать детали"}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border shrink-0 ${prioStyle}`}>
            {priorityLabel[prio]}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {row.folder} · {row.group}
            </div>
            <div className="text-xs font-mono text-foreground/80 truncate" title={row.url}>
              {row.url || "—"}
            </div>
          </div>
          <span
            className={
              "tabular-nums text-xs shrink-0 " +
              (coverage >= 70 ? "text-chart-2" : coverage >= 40 ? "text-chart-4" : "text-muted-foreground")
            }
            title={`${usedAll.size} из ${wordSet.size} ключевых слов`}
          >
            {coverage}%
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

        {expanded && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs mb-2 pl-6 text-muted-foreground">
            <span>Частота: <span className="tabular-nums text-foreground">{freq || "—"}</span></span>
            <span title="Средняя позиция в Google">G: <span className={"tabular-nums " + posColor(gPos)}>{gPos || "—"}</span></span>
            <span title="Средняя позиция в Яндекс">Я: <span className={"tabular-nums " + posColor(yPos)}>{yPos || "—"}</span></span>
            <span>Рек. месяц: <span className="text-foreground">{MONTHS[rec]}</span></span>
            <span>Ключей: <span className="tabular-nums text-foreground">{usedAll.size}/{wordSet.size}</span></span>
          </div>
        )}

        {/* Two-column: edits | keywords */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-3">
          <div className="space-y-1.5">
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
          <KeywordsPanel words={words} used={usedAll} />
        </div>
      </CardContent>
    </Card>
  );
});

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
      {value && (
        <div className="px-1.5 pt-0.5 text-[10px] leading-snug break-words opacity-80">
          <Highlighted text={value} words={words} />
        </div>
      )}
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
