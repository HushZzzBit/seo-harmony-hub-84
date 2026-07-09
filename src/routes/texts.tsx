import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
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
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { VariableHint } from "@/components/VariableHint";
import { RichTextEditor } from "@/components/RichTextEditor";
import type { TextStatus } from "@/lib/types";

export const Route = createFileRoute("/texts")({
  ssr: false,
  component: () => <ClientOnly fallback={null}><TextsPage /></ClientOnly>,
});

const statusLabel: Record<TextStatus, string> = {
  not_assigned: "Не назначено",
  in_progress: "В работе",
  review: "На проверке",
  ready: "Готов к выгрузке",
  in_csv: "В файле CSV",
  done: "Готово",
};

const PAGE_SIZE = 50;

type SortKey = "priority" | "group" | "url" | "planMonth" | "hasText" | "length" | "assignee" | "status";
type SortDir = "asc" | "desc";

const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };

function TextsPage() {
  const { queries, urls, texts, setText } = useStore();
  const [folder, setFolder] = useState("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
      const st = texts[r.url]?.status ?? "not_assigned";
      if (statusFilter !== "all" && st !== statusFilter) return false;
      return true;
    }).map((r) => {
      const t = texts[r.url] ?? { url: r.url, status: "not_assigned" as TextStatus };
      const uRow = urls[r.url];
      const seasonality = groupSeasonality(r.qs);
      const planMonth = t.plannedMonth ?? recommendedMonth(seasonality);
      const has = uRow?.hasText || !!t.text;
      const len = (t.text ? stripHtml(t.text).length : uRow?.textLength) ?? 0;
      const prio = priorityForGroup(seasonality);
      const dist = (recommendedMonth(seasonality) - now + 12) % 12;
      return { r, t, uRow, seasonality, planMonth, has, len, prio, dist };
    });

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
  }, [queries, folder, category, search, statusFilter, texts, urls, sortKey, sortDir]);

  useEffect(() => { setLimit(PAGE_SIZE); }, [folder, category, search, statusFilter, sortKey, sortDir]);
  const visible = rows.slice(0, limit);
  const hasMore = rows.length > visible.length;

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };

  const SortHeader = ({ k, children, className = "text-left" }: { k: SortKey; children: React.ReactNode; className?: string }) => {
    const Icon = sortKey !== k ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th className={`p-2 ${className}`}>
        <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground transition uppercase text-xs">
          {children}
          <Icon className={`h-3 w-3 ${sortKey === k ? "text-foreground" : "opacity-50"}`} />
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
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <SortHeader k="priority">Приоритет</SortHeader>
                <SortHeader k="group">Папка / Группа</SortHeader>
                <SortHeader k="url">URL</SortHeader>
                <SortHeader k="planMonth">Плановый месяц</SortHeader>
                <SortHeader k="hasText" className="text-center">Текст</SortHeader>
                <SortHeader k="length" className="text-right">Длина</SortHeader>
                <SortHeader k="assignee">Исполнитель</SortHeader>
                <SortHeader k="status">Статус</SortHeader>
                <th className="p-2"></th>
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
                return (
                  <tr key={r.url || r.folder + r.group} className="border-t border-border hover:bg-muted/30">
                    <td className="p-2 align-top">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${prioStyle}`}>{prioLabel}</span>
                    </td>
                    <td className="p-2 align-top">
                      <div className="text-xs text-muted-foreground">{r.folder}</div>
                      <div className="font-medium">{r.group}</div>
                    </td>
                    <td className="p-2 align-top max-w-[220px]"><div className="truncate text-xs">{r.url || "—"}</div></td>
                    <td className="p-2 align-top">
                      <div className="flex items-center gap-1">
                        <span className="text-xs">{MONTHS[planMonth]}</span>
                        <span className="text-[10px] text-muted-foreground">(реком.: {MONTHS[recommendedMonth(seasonality)]})</span>
                      </div>
                    </td>
                    <td className="p-2 align-top text-center text-lg">{has ? "🟢" : "🔴"}</td>
                    <td className="p-2 align-top text-right">{len}</td>
                    <td className="p-2 align-top">
                      <Input value={t.assignee ?? ""} onChange={(e) => setText(r.url, { assignee: e.target.value })} className="h-7 text-xs w-28" />
                    </td>
                    <td className="p-2 align-top">
                      <Select value={t.status} onValueChange={(v) => setText(r.url, { status: v as TextStatus })}>
                        <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusLabel).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2 align-top"><TextEditor url={r.url} folder={r.folder} group={r.group} /></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Нет строк.</td></tr>
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
  const { texts, setText, urls, queries } = useStore();
  const [open, setOpen] = useState(false);
  const t = texts[url] ?? { url, status: "not_assigned" as TextStatus };
  const initial = t.text ?? urls[url]?.text ?? "";
  const [value, setValue] = useState(initial);
  const [editor, setEditorRef] = useState<import("@tiptap/react").Editor | null>(null);
  const [tab, setTab] = useState("editor");
  const [kwFilter, setKwFilter] = useState("");
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

  const visiblePhrases = kwFilter
    ? phrases.filter((p) => p.phrase.toLowerCase().includes(kwFilter.toLowerCase()))
    : phrases;
  const visibleWords = kwFilter
    ? words.filter((w) => w.word.includes(kwFilter.toLowerCase()))
    : words;

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
        if (o) setValue(t.text ?? urls[url]?.text ?? "");
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
                  className="prose prose-sm dark:prose-invert max-w-none border rounded-md p-6 h-[60vh] overflow-auto bg-background kw-preview"
                  dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                />
              </TabsContent>

              <TabsContent value="html" className="flex-1 min-h-0 mt-2">
                <Textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="font-mono text-xs h-[60vh] resize-none"
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
              <Input
                value={kwFilter}
                onChange={(e) => setKwFilter(e.target.value)}
                placeholder="Фильтр ключей..."
                className="h-8 text-xs"
              />
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

        <div className="flex justify-between items-center gap-4 px-5 py-3 border-t bg-background">
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
                setOpen(false);
              }}
            >
              Сохранить
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

