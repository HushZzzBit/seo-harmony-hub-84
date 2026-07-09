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
          <h1 className="text-2xl font-semibold">SEO Texts</h1>
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
  const { texts, setText, urls } = useStore();
  const [open, setOpen] = useState(false);
  const t = texts[url] ?? { url, status: "not_assigned" as TextStatus };
  const initial = t.text ?? urls[url]?.text ?? "";
  const [value, setValue] = useState(initial);
  const [tab, setTab] = useState("html");

  const plain = stripHtml(value);
  const words = plain ? plain.split(/\s+/).length : 0;

  const wrap = (tag: string) => {
    const ta = document.getElementById(`html-editor-${url}`) as HTMLTextAreaElement | null;
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = value.slice(s, e);
    const next = value.slice(0, s) + `<${tag}>${sel}</${tag}>` + value.slice(e);
    setValue(next);
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(s + tag.length + 2, s + tag.length + 2 + sel.length);
    }, 0);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(t.text ?? urls[url]?.text ?? ""); }}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Текст</Button></DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{folder} / {group}</DialogTitle>
          <div className="text-xs font-mono text-muted-foreground truncate">{url}</div>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <TabsList>
              <TabsTrigger value="html">HTML</TabsTrigger>
              <TabsTrigger value="preview">Превью</TabsTrigger>
            </TabsList>
            <div className="flex gap-1 flex-wrap">
              {["h1","h2","h3","p","ul","ol","li","strong","em","a"].map((tag) => (
                <Button key={tag} size="sm" variant="outline" className="h-7 px-2 text-xs font-mono" onClick={() => wrap(tag)}>
                  {tag}
                </Button>
              ))}
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setValue(formatHtml(value))}>
                Форматировать
              </Button>
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => { if (!isHtml(value)) setValue(wrapPlainInHtml(value)); }}>
                Обернуть в HTML
              </Button>
            </div>
          </div>

          <TabsContent value="html" className="flex-1 min-h-0 mt-2">
            <Textarea
              id={`html-editor-${url}`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono text-sm h-[55vh] resize-none"
              placeholder="<h1>Заголовок</h1>\n<p>Абзац...</p>"
              spellCheck={false}
            />
          </TabsContent>
          <TabsContent value="preview" className="flex-1 min-h-0 mt-2">
            <div
              className="prose prose-sm max-w-none border rounded-md p-4 h-[55vh] overflow-auto bg-background"
              dangerouslySetInnerHTML={{ __html: value }}
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-between items-center gap-4 pt-2 border-t">
          <div className="text-xs text-muted-foreground flex gap-3">
            <span>{value.length} симв. HTML</span>
            <span>{plain.length} симв. текст</span>
            <span>{words} слов</span>
            <span className={isHtml(value) ? "text-emerald-500" : "text-amber-500"}>
              {isHtml(value) ? "HTML ✓" : "нужен HTML"}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button>
            <Button onClick={() => {
              const finalHtml = isHtml(value) ? value : wrapPlainInHtml(value);
              setText(url, { text: finalHtml });
              setOpen(false);
            }}>Сохранить</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
