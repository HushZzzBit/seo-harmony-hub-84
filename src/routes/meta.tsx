import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { extractWords, metaFor, tokenize } from "@/lib/seo";
import type { Query, Status } from "@/lib/types";

export const Route = createFileRoute("/meta")({
  ssr: false,
  component: () => (
    <ClientOnly fallback={null}>
      <MetaPage />
    </ClientOnly>
  ),
});

type Row = { folder: string; group: string; url: string; qs: Query[] };

const PAGE_SIZE = 50;

function MetaPage() {
  const { queries, metaEdits } = useStore();
  const [folder, setFolder] = useState<string>("all");
  const [group, setGroup] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const folders = useMemo(
    () => Array.from(new Set(queries.map((q) => q.folder))).sort(),
    [queries],
  );

  // Группы — либо все, либо ограниченные выбранной папкой
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

  const rows = useMemo<Row[]>(() => {
    const byUrl = new Map<string, Row>();
    for (const q of queries) {
      const key = q.url ?? `~${q.folder}/${q.group}`;
      if (!byUrl.has(key))
        byUrl.set(key, { folder: q.folder, group: q.group, url: q.url ?? "", qs: [] });
      byUrl.get(key)!.qs.push(q);
    }
    return Array.from(byUrl.values()).filter((r) => {
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
    });
  }, [queries, folder, group, search, statusFilter, metaEdits]);

  return (
    <AppShell>
      <div className="flex items-end justify-between mb-4 gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Meta Tags</h1>
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
            <SelectTrigger className="w-48 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все папки</SelectItem>
              {folders.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={group} onValueChange={setGroup}>
            <SelectTrigger className="w-48 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все группы</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g} value={g}>
                  {g}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="not_started">Не начато</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="in_csv">В файле CSV</SelectItem>
              <SelectItem value="done">Готово</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <MetaRow key={r.url || r.folder + r.group} row={r} />
        ))}
        {rows.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground text-sm">
              Нет строк. Загрузите данные во вкладке Import.
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function MetaRow({ row }: { row: Row }) {
  const { urls, metaEdits, setMetaEdit } = useStore();
  const m = metaFor(row.url, urls, metaEdits);

  const words = useMemo(() => extractWords(row.qs.map((q) => q.phrase)), [row.qs]);
  const wordSet = useMemo(() => new Set(words.map((w) => w.word)), [words]);

  const [title, setTitle] = useState(m.title);
  const [desc, setDesc] = useState(m.description);
  const [h1, setH1] = useState(m.h1);
  const status: Status = metaEdits[row.url]?.status ?? "not_started";

  useEffect(() => {
    setTitle(m.title);
    setDesc(m.description);
    setH1(m.h1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.title, m.description, m.h1]);

  const freq = row.qs.reduce((a, q) => a + (q.frequency || 0), 0);
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

  return (
    <Card className={`border-l-4 ${statusRing}`}>
      <CardContent className="p-3">
        {/* Header row: URL + status + meta */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {row.folder} · {row.group}
            </div>
            <div className="text-xs font-mono text-foreground/80 truncate" title={row.url}>
              {row.url || "—"}
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs shrink-0">
            <span className="text-muted-foreground">
              Частота: <span className="tabular-nums text-foreground">{freq || "—"}</span>
            </span>
            <span className="text-muted-foreground" title="Средняя позиция в Google">
              G: <span className={"tabular-nums " + posColor(gPos)}>{gPos || "—"}</span>
            </span>
            <span className="text-muted-foreground" title="Средняя позиция в Яндекс">
              Я: <span className={"tabular-nums " + posColor(yPos)}>{yPos || "—"}</span>
            </span>
            <span
              className={
                "tabular-nums " +
                (coverage >= 70 ? "text-chart-2" : coverage >= 40 ? "text-chart-4" : "text-muted-foreground")
              }
              title={`${usedAll.size} из ${wordSet.size} ключевых слов`}
            >
              {coverage}%
            </span>
            <Select value={status} onValueChange={(v) => save({ status: v as Status })}>
              <SelectTrigger className="h-7 text-xs w-36">
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
        </div>

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
        className="w-full resize-none bg-transparent text-xs leading-snug rounded px-1.5 py-1 border border-border/50 hover:border-border focus:border-ring focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        spellCheck={false}
      />
      {value && (
        <div className="px-1.5 pt-0.5 text-[11px] leading-snug break-words">
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

