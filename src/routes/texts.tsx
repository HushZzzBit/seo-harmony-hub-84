import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useStore } from "@/lib/store";
import { groupSeasonality, MONTHS, recommendedMonth } from "@/lib/seo";
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

function TextsPage() {
  const { queries, urls, texts, setText } = useStore();
  const [folder, setFolder] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const folders = useMemo(() => Array.from(new Set(queries.map((q) => q.folder))).sort(), [queries]);

  const rows = useMemo(() => {
    const byUrl = new Map<string, { folder: string; group: string; url: string; qs: typeof queries }>();
    for (const q of queries) {
      const key = q.url ?? `~${q.folder}/${q.group}`;
      if (!byUrl.has(key)) byUrl.set(key, { folder: q.folder, group: q.group, url: q.url ?? "", qs: [] });
      byUrl.get(key)!.qs.push(q);
    }
    return Array.from(byUrl.values()).filter((r) => {
      if (folder !== "all" && r.folder !== folder) return false;
      if (search && !(r.url + r.group).toLowerCase().includes(search.toLowerCase())) return false;
      const st = texts[r.url]?.status ?? "not_assigned";
      if (statusFilter !== "all" && st !== statusFilter) return false;
      return true;
    });
  }, [queries, folder, search, statusFilter, texts]);

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
                <th className="text-left p-2">Папка / Группа</th>
                <th className="text-left p-2">URL</th>
                <th className="text-left p-2">Плановый месяц</th>
                <th className="text-center p-2">Текст</th>
                <th className="text-right p-2">Длина</th>
                <th className="text-left p-2">Исполнитель</th>
                <th className="text-left p-2">Статус</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = texts[r.url] ?? { url: r.url, status: "not_assigned" as TextStatus };
                const uRow = urls[r.url];
                const seasonality = groupSeasonality(r.qs);
                const planMonth = t.plannedMonth ?? recommendedMonth(seasonality);
                const has = uRow?.hasText || !!t.text;
                const len = (t.text ? stripHtml(t.text).length : uRow?.textLength) ?? 0;
                return (
                  <tr key={r.url || r.folder + r.group} className="border-t border-border hover:bg-muted/30">
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
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Нет строк.</td></tr>
              )}
            </tbody>
          </table>
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
