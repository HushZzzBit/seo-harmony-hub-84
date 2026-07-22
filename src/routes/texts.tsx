import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/lib/store";
import { groupSeasonality, MONTHS, recommendedMonth, priorityForGroup } from "@/lib/seo";
import { ArrowUpDown, ArrowUp, ArrowDown, ExternalLink, RefreshCw, Loader2, Check, AlertTriangle, X } from "lucide-react";
import { VariableHint } from "@/components/VariableHint";
import { RichTextEditor } from "@/components/RichTextEditor";
import { RoundCheckbox } from "@/components/RoundCheckbox";
import type { TextStatus, TextQualityCheck, QualityProviderResult, QualityProvider } from "@/lib/types";
import { checkTextQuality } from "@/lib/quality.functions";
import { overallDot, overallLabel, providerLabel, providerMetrics, zoneClass } from "@/lib/quality";
import { toast } from "sonner";

const QUALITY_MAX_RUNS = 5;
const QUALITY_MIN_INTERVAL_MS = 60_000; // 1 минута
const QUALITY_MIN_DIFF_CHARS = 10;

async function sha1Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/texts")({
  ssr: false,
  component: () => <ClientOnly fallback={null}><TextsPage /></ClientOnly>,
});

function normStatus(s: string | undefined): TextStatus {
  if (s === "in_progress") return "copywriting";
  if (s === "review") return "revision";
  return (s as TextStatus) ?? "not_assigned";
}

const statusLabel: Record<TextStatus, string> = {
  not_assigned: "Не назначено",
  copywriting: "Копирайтинг",
  expansion: "Расширение",
  revision: "Доработка",
  ready: "Готов к выгрузке",
  in_csv: "В файле CSV",
  done: "Готово",
};

const PAGE_SIZE = 50;

type SortKey = "priority" | "group" | "url" | "planMonth" | "hasText" | "length" | "assignee" | "status";
type SortDir = "asc" | "desc";

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };

function TextsPage() {
  const queries = useStore((s) => s.queries);
  const urls = useStore((s) => s.urls);
  const texts = useStore((s) => s.texts);
  const setText = useStore((s) => s.setText);
  const [folder, setFolder] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<TextStatus | "">("");

  const folders = useMemo(() => Array.from(new Set(queries.map((q) => q.folder))).sort(), [queries]);
  const categories = useMemo(() => {
    const src = folder === "all" ? queries : queries.filter((q) => q.folder === folder);
    return Array.from(new Set(src.map((q) => q.group))).sort();
  }, [queries, folder]);

  useEffect(() => { setCategory("all"); }, [folder]);

  const rows = useMemo(() => {
    const byUrl = new Map<string, { folder: string; group: string; url: string; qs: typeof queries }>();
    for (const q of queries) {
      const key = q.url ?? `~${q.folder}/${q.group}`;
      if (!byUrl.has(key)) byUrl.set(key, { folder: q.folder, group: q.group, url: q.url ?? "", qs: [] });
      byUrl.get(key)!.qs.push(q);
    }
    const now = new Date().getMonth();
    const enriched = Array.from(byUrl.values()).filter((r) => {
      if (folder !== "all" && r.folder !== folder) return false;
      if (category !== "all" && r.group !== category) return false;
      if (search && !(r.url + r.group).toLowerCase().includes(search.toLowerCase())) return false;
      const st = normStatus(texts[r.url]?.status);
      if (statusFilter !== "all" && st !== statusFilter) return false;
      return true;
    }).map((r) => {
      const raw = texts[r.url] ?? { url: r.url, status: "not_assigned" as TextStatus };
      const t = { ...raw, status: normStatus(raw.status) };
      const uRow = urls[r.url];
      const seasonality = groupSeasonality(r.qs);
      const planMonth = t.plannedMonth ?? recommendedMonth(seasonality);
      const has = uRow?.hasText || !!t.text;
      const len = (t.text ? stripHtml(t.text).length : uRow?.textLength) ?? 0;
      const prio = priorityForGroup(seasonality);
      const dist = (recommendedMonth(seasonality) - now + 12) % 12;
      return { r, t, uRow, seasonality, planMonth, has, len, prio, dist };
    }).filter((e) => priorityFilter === "all" || e.prio === priorityFilter);

    const dir = sortDir === "asc" ? 1 : -1;
    const cmp = (a: typeof enriched[number], b: typeof enriched[number]): number => {
      switch (sortKey) {
        case "priority": {
          const d = priorityRank[a.prio] - priorityRank[b.prio];
          return (d !== 0 ? d : a.dist - b.dist) * dir;
        }
        case "group": return (a.r.folder + a.r.group).localeCompare(b.r.folder + b.r.group) * dir;
        case "url": return a.r.url.localeCompare(b.r.url) * dir;
        case "planMonth": return (a.planMonth - b.planMonth) * dir;
        case "hasText": return (Number(a.has) - Number(b.has)) * dir;
        case "length": return (a.len - b.len) * dir;
        case "assignee": return (a.t.assignee ?? "").localeCompare(b.t.assignee ?? "") * dir;
        case "status": return (a.t.status ?? "").localeCompare(b.t.status ?? "") * dir;
      }
    };
    return enriched.sort(cmp);
  }, [queries, folder, category, search, statusFilter, priorityFilter, texts, urls, sortKey, sortDir]);

  useEffect(() => { setLimit(PAGE_SIZE); }, [folder, category, search, statusFilter, priorityFilter, sortKey, sortDir]);
  const visible = rows.slice(0, limit);
  const hasMore = rows.length > visible.length;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const SortHeader = ({ k, children, className = "" }: { k: SortKey; children: React.ReactNode; className?: string }) => {
    const Icon = sortKey !== k ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={`px-2 py-2 text-left font-medium ${className}`}>
        <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground transition">
          <span className="truncate">{children}</span>
          <Icon className={`h-3 w-3 shrink-0 ${sortKey === k ? "text-foreground" : "opacity-40"}`} />
        </button>
      </th>
    );
  };

  return (
    <AppShell>
      <div className="flex items-end justify-between mb-4 gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">SEO Texts</h1>
            <VariableHint />
          </div>
          <p className="text-sm text-muted-foreground">Планирование и написание текстов</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Поиск" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56 h-9" />
          <Select value={folder} onValueChange={setFolder}>
            <SelectTrigger className="w-48 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все папки</SelectItem>
              {folders.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-48 h-9"><SelectValue placeholder="Категория" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все категории</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все приоритеты</SelectItem>
              <SelectItem value="high">Высокий</SelectItem>
              <SelectItem value="medium">Средний</SelectItem>
              <SelectItem value="low">Низкий</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-muted/40">
        <span className="text-sm">Выбрано: <span className="font-medium">{selected.size}</span></span>
        <div className="flex items-center gap-2 ml-auto">
          <Select value={bulkStatus} onValueChange={(v) => setBulkStatus(v as TextStatus)}>
            <SelectTrigger className="h-8 text-xs w-44"><SelectValue placeholder="Изменить статус на…" /></SelectTrigger>
            <SelectContent>
              {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={selected.size === 0 || !bulkStatus}
            onClick={() => {
              if (!bulkStatus) return;
              for (const u of selected) setText(u, { status: bulkStatus as TextStatus });
              setSelected(new Set());
              setBulkStatus("");
            }}
          >Применить</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Снять выбор</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-xs table-fixed">
            <thead className="bg-muted/50 text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-1.5 py-1.5 w-8">
                  {(() => {
                    const selCount = visible.filter((e) => e.r.url && selected.has(e.r.url)).length;
                    const allChecked = visible.length > 0 && selCount === visible.length;
                    return (
                      <RoundCheckbox
                        aria-label="Выбрать все"
                        checked={allChecked}
                        indeterminate={selCount > 0 && selCount < visible.length}
                        onChange={(next) => {
                          setSelected((prev) => {
                            const n = new Set(prev);
                            if (selCount > 0 || !next) {
                              visible.forEach((v) => v.r.url && n.delete(v.r.url));
                              if (selCount === 0 && next) visible.forEach((v) => v.r.url && n.add(v.r.url));
                            } else {
                              visible.forEach((v) => v.r.url && n.add(v.r.url));
                            }
                            return n;
                          });
                        }}
                      />
                    );
                  })()}
                </th>
                <SortHeader k="priority" className="w-20">Приор.</SortHeader>
                <SortHeader k="group" className="w-44">Папка / Группа</SortHeader>
                <SortHeader k="url" className="w-[22%]">URL</SortHeader>
                <SortHeader k="planMonth" className="w-16">Мес.</SortHeader>
                <SortHeader k="hasText" className="text-center w-16">Наличие</SortHeader>
                <SortHeader k="length" className="text-right w-14">Длина</SortHeader>
                <SortHeader k="assignee" className="w-28">Исполн.</SortHeader>
                <SortHeader k="status" className="w-32">Статус</SortHeader>
                <th className="px-1.5 py-1.5 text-center w-14">Кач-во</th>
                <th className="px-1.5 py-1.5 w-10"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ r, t, has, len, planMonth, seasonality, prio }) => {
                const prioStyle = prio === "high"
                  ? "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30"
                  : prio === "medium"
                  ? "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30"
                  : "bg-muted text-muted-foreground border-border";
                const prioLabel = prio === "high" ? "Высокий" : prio === "medium" ? "Средний" : "Низкий";
                const isSel = !!r.url && selected.has(r.url);
                return (
                  <tr key={r.url || r.folder + r.group} className={`border-t border-border hover:bg-muted/30 ${isSel ? "bg-primary/5" : ""}`}>
                    <td className="px-1.5 py-1 align-middle">
                      <RoundCheckbox
                        aria-label="Выбрать строку"
                        disabled={!r.url}
                        checked={isSel}
                        onChange={(next) => {
                          if (!r.url) return;
                          setSelected((prev) => {
                            const n = new Set(prev);
                            if (next) n.add(r.url);
                            else n.delete(r.url);
                            return n;
                          });
                        }}
                      />
                    </td>
                    <td className="px-1.5 py-1 align-middle">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${prioStyle}`}>{prioLabel}</span>
                    </td>
                    <td className="px-1.5 py-1 align-middle overflow-hidden">
                      <div className="text-[10px] text-muted-foreground truncate leading-tight">{r.folder}</div>
                      <div className="font-medium truncate leading-tight">{r.group}</div>
                    </td>
                    <td className="px-1.5 py-1 align-middle overflow-hidden">
                      <div className="flex items-center gap-1">
                        <div className="truncate text-[11px] flex-1">{r.url || "—"}</div>
                        {r.url && (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 inline-flex items-center justify-center text-muted-foreground hover:text-primary transition"
                            title="Открыть URL"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-1.5 py-1 align-middle">
                      <span className="text-[11px]">{MONTHS[planMonth]}</span>
                    </td>
                    <td className="px-1.5 py-1 align-middle text-center text-sm">{has ? "🟢" : "🔴"}</td>
                    <td className="px-1.5 py-1 align-middle text-right text-[11px]">{len}</td>
                    <td className="px-1.5 py-1 align-middle">
                      <Input value={t.assignee ?? ""} onChange={(e) => setText(r.url, { assignee: e.target.value })} className="h-6 text-[11px] w-full px-2" />
                    </td>
                    <td className="px-1.5 py-1 align-middle">
                      <Select value={t.status} onValueChange={(v) => setText(r.url, { status: v as TextStatus })}>
                        <SelectTrigger className="h-6 text-[11px] w-full px-2"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1.5 py-1 align-middle"><QualityCell url={r.url} /></td>
                    <td className="px-1.5 py-1 align-middle"><TextEditor url={r.url} folder={r.folder} group={r.group} /></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">Нет строк.</td></tr>
              )}

            </tbody>
          </table>
          {hasMore && (
            <div className="flex items-center justify-center gap-3 py-3 border-t border-border text-xs text-muted-foreground">
              <span>Показано {visible.length} из {rows.length}</span>
              <button
                type="button"
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
                className="px-3 py-1.5 rounded-lg border border-border hover:bg-accent transition"
              >
                Показать ещё {Math.min(PAGE_SIZE, rows.length - visible.length)}
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}


function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function isHtml(s: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(s);
}

function wrapPlainInHtml(s: string): string {
  const paragraphs = s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("\n");
}

function formatHtml(s: string): string {
  // simple indenter: newline after block tags
  return s
    .replace(/>\s*</g, ">\n<")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function TextEditor({ url, folder, group }: { url: string; folder: string; group: string }) {
  const raw = useStore((s) => s.texts[url]) ?? { url, status: "not_assigned" as TextStatus };
  const t = { ...raw, status: normStatus(raw.status) };
  const urlText = useStore((s) => s.urls[url]?.text);
  const queries = useStore((s) => s.queries);
  const setText = useStore((s) => s.setText);
  const runQualityCheck = useQualityRunner();
  const [open, setOpen] = useState(false);
  const initial = t.text ?? urlText ?? "";
  const [value, setValue] = useState(initial);
  const [editor, setEditorRef] = useState<import("@tiptap/react").Editor | null>(null);
  const [tab, setTab] = useState("editor");
  const [highlight, setHighlight] = useState(true);

  const groupQueries = useMemo(
    () => queries.filter((q) => q.folder === folder && q.group === group),
    [queries, folder, group],
  );

  const plain = stripHtml(value);
  const plainLower = plain.toLowerCase().replace(/ё/g, "е");
  const wordsCnt = plain ? plain.split(/\s+/).filter(Boolean).length : 0;

  const phrases = useMemo(() => {
    const arr = groupQueries.map((q) => {
      const p = q.phrase.trim();
      const norm = p.toLowerCase().replace(/ё/g, "е");
      const re = new RegExp(escapeRe(norm), "g");
      const count = (plainLower.match(re) ?? []).length;
      return { phrase: p, freq: q.frequency || 0, count };
    });
    // dedupe by phrase
    const seen = new Map<string, typeof arr[number]>();
    for (const x of arr) {
      const prev = seen.get(x.phrase.toLowerCase());
      if (!prev) seen.set(x.phrase.toLowerCase(), x);
      else prev.freq += x.freq;
    }
    return Array.from(seen.values()).sort((a, b) => b.freq - a.freq);
  }, [groupQueries, plainLower]);

  const usedPhrases = phrases.filter((p) => p.count > 0).length;
  const coverage = phrases.length ? Math.round((usedPhrases / phrases.length) * 100) : 0;

  const words = useMemo(() => {
    const map = new Map<string, number>();
    for (const q of groupQueries) {
      for (const w of new Set(
        q.phrase.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i).filter((w) => w && w.length > 2),
      )) {
        map.set(w, (map.get(w) ?? 0) + (q.frequency || 1));
      }
    }
    return Array.from(map, ([word, weight]) => {
      const re = new RegExp(`\\b${escapeRe(word)}\\b`, "gi");
      const count = (plainLower.match(re) ?? []).length;
      return { word, weight, count };
    }).sort((a, b) => b.weight - a.weight);
  }, [groupQueries, plainLower]);

  const visiblePhrases = phrases;
  const visibleWords = words;

  const insertAtCursor = (text: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(text + " ").run();
  };

  const highlightedHtml = useMemo(() => {
    if (!highlight) return value;
    if (!phrases.length) return value;
    return highlightKeywords(
      value,
      phrases.map((p) => p.phrase),
    );
  }, [value, phrases, highlight]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setValue(t.text ?? urlText ?? "");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">Текст</Button>
      </DialogTrigger>
      <DialogContent className="max-w-[1200px] w-[95vw] max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-4 pb-2 border-b">
          <DialogTitle className="text-base">
            {folder} <span className="text-muted-foreground">/</span> {group}
          </DialogTitle>
          <div className="text-xs font-mono text-muted-foreground truncate">{url || "—"}</div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0">
          {/* Editor */}
          <div className="flex-1 min-w-0 flex flex-col p-4 gap-2">
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <TabsList className="w-fit">
                <TabsTrigger value="editor">Редактор</TabsTrigger>
                <TabsTrigger value="preview">Превью {highlight ? "(с ключами)" : ""}</TabsTrigger>
                <TabsTrigger value="html">HTML-код</TabsTrigger>
              </TabsList>

              <TabsContent value="editor" className="flex-1 min-h-0 mt-2">
                <RichTextEditor value={value} onChange={setValue} onEditor={setEditorRef} />
              </TabsContent>

              <TabsContent value="preview" className="flex-1 min-h-0 mt-2">
                <div className="flex items-center gap-2 mb-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={highlight}
                      onChange={(e) => setHighlight(e.target.checked)}
                      className="accent-primary"
                    />
                    Подсвечивать ключи
                  </label>
                </div>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none border rounded-md p-6 h-full overflow-auto bg-background kw-preview"
                  dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                />
              </TabsContent>

              <TabsContent value="html" className="flex-1 min-h-0 mt-2 flex flex-col">
                <Textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="font-mono text-xs flex-1 min-h-0 resize-none"
                  spellCheck={false}
                />
                <div className="flex gap-2 mt-2">
                  <Button size="sm" variant="outline" onClick={() => setValue(formatHtml(value))}>Форматировать</Button>
                  <Button size="sm" variant="outline" onClick={() => { if (!isHtml(value)) setValue(wrapPlainInHtml(value)); }}>Обернуть в HTML</Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          {/* Keywords sidebar */}
          <aside className="w-[340px] shrink-0 border-l flex flex-col bg-muted/20">
            <div className="p-3 border-b space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Ключи</div>
                <div className="text-xs text-muted-foreground">{usedPhrases}/{phrases.length} использовано</div>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${coverage}%` }}
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-3">
              <section>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground px-1 mb-1">
                  Фразы ({visiblePhrases.length})
                </div>
                <div className="space-y-1">
                  {visiblePhrases.map((p) => (
                    <button
                      key={p.phrase}
                      type="button"
                      onClick={() => insertAtCursor(p.phrase)}
                      title="Вставить в текст"
                      className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center justify-between gap-2 border transition ${
                        p.count > 0
                          ? "bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20"
                          : "bg-background border-border hover:bg-accent"
                      }`}
                    >
                      <span className="truncate">{p.phrase}</span>
                      <span className="flex items-center gap-1 shrink-0 text-[10px] text-muted-foreground">
                        <span title="Частотность">{p.freq}</span>
                        <span
                          className={`px-1.5 py-0.5 rounded-full font-semibold ${
                            p.count > 0
                              ? "bg-emerald-500 text-white"
                              : "bg-muted text-muted-foreground"
                          }`}
                          title="Вхождений в текст"
                        >
                          {p.count}
                        </span>
                      </span>
                    </button>
                  ))}
                  {visiblePhrases.length === 0 && (
                    <div className="text-xs text-muted-foreground px-1 py-2">Нет ключей.</div>
                  )}
                </div>
              </section>

              <section>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground px-1 mb-1">
                  Слова ({visibleWords.length})
                </div>
                <div className="flex flex-wrap gap-1">
                  {visibleWords.slice(0, 60).map((w) => (
                    <button
                      key={w.word}
                      type="button"
                      onClick={() => insertAtCursor(w.word)}
                      className={`px-2 py-0.5 rounded-full text-[11px] border transition ${
                        w.count > 0
                          ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                          : "bg-background border-border hover:bg-accent"
                      }`}
                      title={`вес ${w.weight}, вхождений ${w.count}`}
                    >
                      {w.word}
                      {w.count > 0 && <span className="ml-1 opacity-70">×{w.count}</span>}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </aside>
        </div>

        <div className="shrink-0">
          <QualityPanel url={url} currentValue={value} />
        </div>

        <div className="flex justify-between items-center gap-4 px-5 py-3 border-t bg-background shrink-0">
          <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
            <span>{plain.length} симв.</span>
            <span>{wordsCnt} слов</span>
            <span>Покрытие ключей: <b className={coverage >= 70 ? "text-emerald-500" : coverage >= 40 ? "text-amber-500" : "text-rose-500"}>{coverage}%</b></span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button
              onClick={() => {
                const finalHtml = isHtml(value) ? value : wrapPlainInHtml(value);
                setText(url, { text: finalHtml });
                // Kick off quality check for the final text (fire-and-forget).
                if (url) void runQualityCheck(url, finalHtml);
                setOpen(false);
              }}
            >
              Сохранить и закрыть
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Highlight keyword phrases in an HTML string by wrapping matches with <mark>.
 * Only touches text nodes so tag attributes stay intact.
 */
function highlightKeywords(html: string, phrases: string[]): string {
  if (typeof window === "undefined" || !phrases.length) return html;
  const uniq = Array.from(new Set(phrases.map((p) => p.trim()).filter(Boolean)))
    .sort((a, b) => b.length - a.length);
  if (!uniq.length) return html;
  const re = new RegExp(`(${uniq.map(escapeRe).join("|")})`, "gi");

  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);
  for (const node of textNodes) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (["MARK", "SCRIPT", "STYLE", "CODE"].includes(parent.tagName)) continue;
    const text = node.nodeValue ?? "";
    if (!re.test(text)) continue;
    re.lastIndex = 0;
    const frag = document.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement("mark");
      mark.className = "kw-mark";
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    parent.replaceChild(frag, node);
  }
  return tpl.innerHTML;
}


// ============================================================
// Quality checks (Text.ru / ZeroGPT / Тургенев)
// ============================================================

function useQualityRunner() {
  const setQualityCheck = useStore((s) => s.setQualityCheck);
  const check = useServerFn(checkTextQuality);
  return async (url: string, html: string, opts?: { silent?: boolean }) => {
    if (!url) return;
    const plain = stripHtml(html);
    if (plain.length < 50) return; // ниже минимума всех провайдеров

    const prev = useStore.getState().qualityChecks[url];
    const now = Date.now();

    // 1) Лимит: не более 5 проверок на URL
    const runCount = prev?.runCount ?? 0;
    if (runCount >= QUALITY_MAX_RUNS) {
      if (!opts?.silent) toast.warning(`Лимит проверок для этого URL исчерпан (${QUALITY_MAX_RUNS}/${QUALITY_MAX_RUNS})`);
      return;
    }
    // 2) Не чаще 1 раза в минуту
    const lastAt = prev?.completedAt ?? prev?.requestedAt ?? 0;
    if (lastAt && now - lastAt < QUALITY_MIN_INTERVAL_MS) {
      const wait = Math.ceil((QUALITY_MIN_INTERVAL_MS - (now - lastAt)) / 1000);
      if (!opts?.silent) toast.info(`Проверка была недавно — повторно можно через ${wait} с`);
      return;
    }
    // 3) Пропустить, если изменилось < 10 символов
    if (prev?.textLength !== undefined) {
      // Сравниваем длиной; если длины близки и raw plain почти совпадает — считаем «мало изменилось».
      // Точный prev-текст не храним, поэтому используем длину как достаточное приближение.
      const diff = Math.abs(plain.length - (prev.textLength ?? 0));
      // Дополнительно: если хеши совпадают (текст идентичен нормализованно) — точно скипнуть.
      const sameHash = prev.textHash && (await sha1Hex(plain)) === prev.textHash;
      if (sameHash || diff < QUALITY_MIN_DIFF_CHARS) {
        if (!opts?.silent) toast.info(`Изменения слишком малы (< ${QUALITY_MIN_DIFF_CHARS} симв.) — проверка не запускалась`);
        return;
      }
    }

    const requestedAt = now;
    const pendingProviders: QualityProviderResult[] = (["text_ru", "zerogpt", "turgenev"] as QualityProvider[]).map((p) => ({
      provider: p,
      status: "pending",
      requestedAt,
    }));
    setQualityCheck(url, {
      url,
      textHash: prev?.textHash ?? "",
      textLength: prev?.textLength,
      requestedAt,
      overall: "checking",
      providers: pendingProviders,
      runCount: runCount + 1,
    });
    try {
      const res = await check({ data: { text: html } });
      const providers = res.providers as unknown as QualityProviderResult[];
      const next: TextQualityCheck = {
        url,
        textHash: res.textHash,
        textLength: plain.length,
        requestedAt: res.requestedAt,
        completedAt: res.completedAt,
        overall: "ok",
        providers,
        runCount: runCount + 1,
      };
      const { overallFromCheck } = await import("@/lib/quality");
      next.overall = overallFromCheck(next);
      setQualityCheck(url, next);
    } catch (e) {
      setQualityCheck(url, {
        url,
        textHash: prev?.textHash ?? "",
        textLength: plain.length,
        requestedAt,
        completedAt: Date.now(),
        overall: "error",
        providers: pendingProviders.map((p) => ({
          ...p,
          status: "failed",
          completedAt: Date.now(),
          error: (e as Error).message,
        })),
        runCount: runCount + 1,
      });
    }

  };
}

function QualityCell({ url }: { url: string }) {
  const check = useStore((s) => s.qualityChecks[url]);
  if (!check) return <span className="text-xs text-muted-foreground">—</span>;
  const label = overallLabel[check.overall];
  const dot = overallDot[check.overall];
  return (
    <div className="flex justify-center">
      <div className="group relative inline-flex items-center gap-1 cursor-help">
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span className="text-[10px] uppercase font-medium text-muted-foreground hidden xl:inline">
          {check.overall === "checking" ? "…" : check.overall === "ok" ? "OK" : check.overall === "warning" ? "!" : check.overall === "fail" ? "×" : "err"}
        </span>
        <div className="absolute z-50 top-full right-0 mt-1 w-72 hidden group-hover:block">
          <QualityTooltip check={check} label={label} />
        </div>
      </div>
    </div>
  );
}

function QualityTooltip({ check, label }: { check: TextQualityCheck; label: string }) {
  return (
    <div className="rounded-md border border-border bg-popover text-popover-foreground shadow-lg p-3 text-xs space-y-2">
      <div className="font-medium">{label}</div>
      <div className="text-muted-foreground text-[10px]">
        {check.completedAt ? new Date(check.completedAt).toLocaleString() : "…"}
      </div>
      <div className="space-y-1">
        {check.providers.map((p) => (
          <div key={p.provider} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{providerLabel[p.provider]}</span>
            <span className="flex items-center gap-1">
              {p.status === "pending" && <Loader2 className="h-3 w-3 animate-spin" />}
              {p.status === "failed" && <span className="text-rose-500">ошибка</span>}
              {p.status === "skipped" && <span className="text-muted-foreground">—</span>}
              {p.status === "success" && providerMetrics(p).map((m) => (
                <span key={m.label} className={`px-1.5 py-0.5 rounded border text-[10px] ${zoneClass[m.zone]}`}>
                  {m.label} {m.value}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityPanel({ url, currentValue }: { url: string; currentValue?: string }) {
  const check = useStore((s) => s.qualityChecks[url]);
  const savedText = useStore((s) => s.texts[url]?.text);
  const text = currentValue ?? savedText;
  const run = useQualityRunner();
  if (!url) return null;
  return (
    <div className="border-t bg-background px-5 py-3">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${overallDot[check?.overall ?? "checking"]}`} />
          <span className="text-sm font-medium truncate">
            {check ? overallLabel[check.overall] : "Проверка качества не запускалась"}
          </span>
          {check?.completedAt && (
            <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:inline">
              {new Date(check.completedAt).toLocaleString()}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!text || check?.overall === "checking"}
          onClick={() => text && run(url, text)}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${check?.overall === "checking" ? "animate-spin" : ""}`} />
          Проверить
        </Button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-stretch">
        {(["text_ru", "zerogpt", "turgenev"] as QualityProvider[]).map((prov) => {
          const p = check?.providers.find((x) => x.provider === prov);
          return <ProviderTile key={prov} provider={prov} p={p} />;
        })}
      </div>
    </div>
  );
}

function ProviderTile({ provider, p }: { provider: QualityProvider; p?: QualityProviderResult }) {
  const label = providerLabel[provider];
  const tileBase = "rounded-md border p-2 text-xs h-full flex flex-col gap-1.5";
  if (!p) {
    return (
      <div className={`${tileBase} border-border bg-background`}>
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground">Не запущено</div>
      </div>
    );
  }
  if (p.status === "pending") {
    return (
      <div className={`${tileBase} border-border bg-background`}>
        <div className="flex items-center justify-between">
          <span className="font-medium">{label}</span>
          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
        </div>
        <div className="text-muted-foreground">Проверка…</div>
      </div>
    );
  }
  if (p.status === "failed") {
    return (
      <div className={`${tileBase} border-rose-500/30 bg-rose-500/5`}>
        <div className="font-medium text-rose-600 dark:text-rose-300">{label}</div>
        <div className="text-[11px] line-clamp-3 opacity-80" title={p.error}>{p.error ?? "Ошибка"}</div>
      </div>
    );
  }
  if (p.status === "skipped") {
    return (
      <div className={`${tileBase} border-border bg-background`}>
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground">Пропущено: {p.error}</div>
      </div>
    );
  }
  const metrics = providerMetrics(p);
  return (
    <div className={`${tileBase} border-border bg-background`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {p.reportUrl && (
          <a href={p.reportUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5 text-[10px]">
            Отчёт <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {metrics.map((m) => (
          <span key={m.label} className={`px-1.5 py-0.5 rounded border text-[10px] ${zoneClass[m.zone]}`}>
            {m.label} {m.value}
          </span>
        ))}
      </div>
    </div>
  );
}
