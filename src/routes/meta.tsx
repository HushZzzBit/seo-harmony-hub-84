import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { extractWords, metaFor, pct, tokenize } from "@/lib/seo";
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

function MetaPage() {
  const { queries, urls, metaEdits } = useStore();
  const [folder, setFolder] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const folders = useMemo(
    () => Array.from(new Set(queries.map((q) => q.folder))).sort(),
    [queries],
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
      if (
        search &&
        !(r.url + r.group + r.folder).toLowerCase().includes(search.toLowerCase())
      )
        return false;
      const st = metaEdits[r.url]?.status ?? "not_started";
      if (statusFilter !== "all" && st !== statusFilter) return false;
      return true;
    });
  }, [queries, folder, search, statusFilter, metaEdits]);

  return (
    <AppShell>
      <div className="flex items-end justify-between mb-4 gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Meta Tags</h1>
          <p className="text-sm text-muted-foreground">
            Инлайн-редактирование Title / Description / H1 с подсветкой Words
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input
            placeholder="Поиск по URL / группе"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 h-9"
          />
          <Select value={folder} onValueChange={setFolder}>
            <SelectTrigger className="w-52 h-9">
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="not_started">Не начато</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="done">Завершено</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground sticky top-0 z-10">
              <tr>
                <th className="text-left p-2 w-[180px]">Папка / Группа</th>
                <th className="text-left p-2 w-[200px]">URL</th>
                <th className="text-left p-2 min-w-[220px]">H1</th>
                <th className="text-left p-2 min-w-[280px]">Title</th>
                <th className="text-left p-2 min-w-[320px]">Description</th>
                <th className="text-right p-2 w-[80px]">Частота</th>
                <th className="text-right p-2 w-[70px]">Ср. поз</th>
                <th className="text-right p-2 w-[70px]">TOP10</th>
                <th className="text-right p-2 w-[70px]">Words</th>
                <th className="text-left p-2 w-[140px]">Статус</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <MetaRow key={r.url || r.folder + r.group} row={r} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-muted-foreground">
                    Нет строк. Загрузите данные во вкладке Import.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="mt-3 text-xs text-muted-foreground flex gap-4">
        <span><span className="inline-block w-3 h-3 align-middle rounded-sm bg-chart-2/40 mr-1" />ключевое слово</span>
        <span><span className="inline-block w-3 h-3 align-middle rounded-sm bg-chart-4/50 mr-1" />повтор</span>
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

  // Sync when store changes externally (e.g. import)
  useEffect(() => {
    setTitle(m.title);
    setDesc(m.description);
    setH1(m.h1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.title, m.description, m.h1]);

  const freq = row.qs.reduce((a, q) => a + (q.frequency || 0), 0);
  const positions = row.qs.map((q) => q.googlePosition ?? 0).filter((n) => n > 0);
  const avgPos = positions.length
    ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1)
    : "—";
  const top10 = row.qs.filter((q) => (q.googlePosition ?? 999) <= 10).length;

  const usedAll = useMemo(() => {
    const s = new Set<string>();
    for (const t of [title, desc, h1])
      for (const w of tokenize(t)) if (wordSet.has(w)) s.add(w);
    return s;
  }, [title, desc, h1, wordSet]);
  const coverage = pct(usedAll.size, wordSet.size);

  function save(patch: { title?: string; description?: string; h1?: string; status?: Status }) {
    if (!row.url) return;
    setMetaEdit(row.url, patch);
  }

  return (
    <tr className="border-t border-border align-top hover:bg-muted/20">
      <td className="p-2">
        <div className="text-[11px] text-muted-foreground">{row.folder}</div>
        <div className="font-medium text-xs leading-tight">{row.group}</div>
      </td>
      <td className="p-2">
        <div className="text-[11px] font-mono text-muted-foreground break-all" title={row.url}>
          {row.url || "—"}
        </div>
      </td>
      <td className="p-1">
        <EditableCell
          value={h1}
          onChange={setH1}
          onCommit={(v) => save({ h1: v })}
          words={wordSet}
        />
      </td>
      <td className="p-1">
        <EditableCell
          value={title}
          onChange={setTitle}
          onCommit={(v) => save({ title: v })}
          words={wordSet}
          maxLen={60}
        />
      </td>
      <td className="p-1">
        <EditableCell
          value={desc}
          onChange={setDesc}
          onCommit={(v) => save({ description: v })}
          words={wordSet}
          maxLen={160}
          rows={2}
        />
      </td>
      <td className="p-2 text-right tabular-nums">{freq || "—"}</td>
      <td className="p-2 text-right tabular-nums">{avgPos}</td>
      <td className="p-2 text-right tabular-nums">{pct(top10, row.qs.length)}%</td>
      <td className="p-2 text-right tabular-nums">
        <span
          className={
            coverage >= 70
              ? "text-chart-2 font-medium"
              : coverage >= 40
                ? "text-chart-4"
                : "text-muted-foreground"
          }
          title={`${usedAll.size} из ${wordSet.size}`}
        >
          {coverage}%
        </span>
      </td>
      <td className="p-1">
        <Select value={status} onValueChange={(v) => save({ status: v as Status })}>
          <SelectTrigger
            className={
              "h-8 text-xs " +
              (status === "done"
                ? "bg-chart-2/15 border-chart-2/40"
                : status === "in_progress"
                  ? "bg-chart-4/15 border-chart-4/40"
                  : "")
            }
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="not_started">Не начато</SelectItem>
            <SelectItem value="in_progress">В работе</SelectItem>
            <SelectItem value="done">Готово</SelectItem>
          </SelectContent>
        </Select>
      </td>
    </tr>
  );
}

/** Google-Sheets-style cell: textarea + highlighted preview underneath. Autosize + autosave on blur. */
function EditableCell({
  value,
  onChange,
  onCommit,
  words,
  maxLen,
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

  const len = value.length;
  const over = maxLen != null && len > maxLen;

  return (
    <div className="group">
      <textarea
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        className="w-full resize-none bg-transparent text-xs leading-snug rounded px-1.5 py-1 border border-transparent hover:border-border focus:border-ring focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring"
      />
      <div className="px-1.5 pb-1 pt-0.5 flex items-start justify-between gap-2">
        <Highlighted text={value} words={words} />
        <span
          className={
            "text-[10px] tabular-nums shrink-0 " +
            (over ? "text-destructive font-medium" : "text-muted-foreground")
          }
        >
          {len}
          {maxLen ? `/${maxLen}` : ""}
        </span>
      </div>
    </div>
  );
}

function Highlighted({ text, words }: { text: string; words: Set<string> }) {
  const seen = new Map<string, number>();
  const parts = text.split(/(\s+)/);
  return (
    <div className="text-[11px] leading-tight break-words min-w-0">
      {parts.map((p, i) => {
        const norm = p
          .toLowerCase()
          .replace(/ё/g, "е")
          .replace(/[^a-zа-я0-9]/gi, "");
        if (!norm) return <span key={i}>{p}</span>;
        const isKw = words.has(norm);
        if (!isKw) return <span key={i} className="text-muted-foreground/60">{p}</span>;
        const count = (seen.get(norm) ?? 0) + 1;
        seen.set(norm, count);
        const cls =
          count > 1 ? "bg-chart-4/50 rounded px-0.5" : "bg-chart-2/40 rounded px-0.5";
        return (
          <span key={i} className={cls}>
            {p}
          </span>
        );
      })}
    </div>
  );
}
