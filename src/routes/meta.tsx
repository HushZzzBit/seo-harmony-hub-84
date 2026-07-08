import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useStore } from "@/lib/store";
import { extractWords, metaFor, pct, tokenize } from "@/lib/seo";
import type { Status } from "@/lib/types";

export const Route = createFileRoute("/meta")({
  ssr: false,
  component: () => <ClientOnly fallback={null}><MetaPage /></ClientOnly>,
});

function MetaPage() {
  const { queries, urls, metaEdits, setMetaEdit } = useStore();
  const [folder, setFolder] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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
      if (search && !(r.url + r.group + r.folder).toLowerCase().includes(search.toLowerCase())) return false;
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
          <p className="text-sm text-muted-foreground">Редактирование Title / Description / H1 с подсветкой Words</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Поиск по URL / группе" value={search} onChange={(e) => setSearch(e.target.value)} className="w-64 h-9" />
          <Select value={folder} onValueChange={setFolder}>
            <SelectTrigger className="w-52 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все папки</SelectItem>
              {folders.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
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
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-2">Папка / Группа</th>
                <th className="text-left p-2">URL</th>
                <th className="text-left p-2">H1</th>
                <th className="text-left p-2">Title</th>
                <th className="text-left p-2">Description</th>
                <th className="text-right p-2">Частота</th>
                <th className="text-right p-2">Ср. поз</th>
                <th className="text-right p-2">TOP10</th>
                <th className="text-left p-2">Статус</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = metaFor(r.url, urls, metaEdits);
                const freq = r.qs.reduce((a, q) => a + (q.frequency || 0), 0);
                const positions = r.qs.map((q) => q.googlePosition ?? 0).filter((n) => n > 0);
                const avgPos = positions.length ? (positions.reduce((a, b) => a + b, 0) / positions.length).toFixed(1) : "—";
                const top10 = r.qs.filter((q) => (q.googlePosition ?? 999) <= 10).length;
                const status: Status = metaEdits[r.url]?.status ?? "not_started";
                return (
                  <tr key={r.url || r.folder + r.group} className="border-t border-border hover:bg-muted/30">
                    <td className="p-2 align-top">
                      <div className="text-xs text-muted-foreground">{r.folder}</div>
                      <div className="font-medium">{r.group}</div>
                    </td>
                    <td className="p-2 align-top max-w-[220px]"><div className="truncate text-xs" title={r.url}>{r.url || "—"}</div></td>
                    <td className="p-2 align-top max-w-[200px]"><div className="truncate text-xs">{m.h1 || "—"}</div></td>
                    <td className="p-2 align-top max-w-[260px]"><div className="truncate text-xs">{m.title || "—"}</div></td>
                    <td className="p-2 align-top max-w-[300px]"><div className="truncate text-xs">{m.description || "—"}</div></td>
                    <td className="p-2 align-top text-right">{freq}</td>
                    <td className="p-2 align-top text-right">{avgPos}</td>
                    <td className="p-2 align-top text-right">{pct(top10, r.qs.length)}%</td>
                    <td className="p-2 align-top">
                      <Badge variant={status === "done" ? "default" : "secondary"} className="text-[10px]">
                        {status === "done" ? "Готово" : status === "in_progress" ? "В работе" : "Не начато"}
                      </Badge>
                    </td>
                    <td className="p-2 align-top text-right">
                      <MetaEditor row={r} />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Нет строк. Загрузите данные во вкладке Import.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function MetaEditor({ row }: { row: { folder: string; group: string; url: string; qs: ReturnType<typeof useStore.getState>["queries"] } }) {
  const { urls, metaEdits, setMetaEdit, metaHistory } = useStore();
  const [open, setOpen] = useState(false);
  const m = metaFor(row.url, urls, metaEdits);
  const [title, setTitle] = useState(m.title);
  const [desc, setDesc] = useState(m.description);
  const [h1, setH1] = useState(m.h1);
  const [status, setStatus] = useState<Status>(metaEdits[row.url]?.status ?? "not_started");

  const words = useMemo(() => extractWords(row.qs.map((q) => q.phrase)), [row.qs]);
  const wordSet = useMemo(() => new Set(words.map((w) => w.word)), [words]);
  const wordFreq = useMemo(() => {
    const m = new Map<string, number>();
    for (const q of row.qs) for (const w of new Set(tokenize(q.phrase))) m.set(w, (m.get(w) ?? 0) + (q.frequency || 0));
    return m;
  }, [row.qs]);

  const usedInText = (text: string) => new Set(tokenize(text));
  const usedAll = useMemo(() => {
    const s = new Set<string>();
    for (const t of [title, desc, h1]) for (const w of tokenize(t)) if (wordSet.has(w)) s.add(w);
    return s;
  }, [title, desc, h1, wordSet]);
  const coverage = pct(usedAll.size, wordSet.size);

  const history = metaHistory.filter((h) => h.url === row.url).slice(-5).reverse();

  function save() {
    setMetaEdit(row.url, { title, description: desc, h1, status });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Ред.</Button></DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="text-sm text-muted-foreground">{row.folder} / {row.group}</DialogTitle>
          <div className="text-xs font-mono text-muted-foreground truncate">{row.url}</div>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-3">
            <Field label={`H1 (${h1.length} симв.)`} used={usedInText(h1)} words={wordSet}>
              <Input value={h1} onChange={(e) => setH1(e.target.value)} />
              <Highlighted text={h1} words={wordSet} />
            </Field>
            <Field label={`Title (${title.length} симв.)`} used={usedInText(title)} words={wordSet}>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              <Highlighted text={title} words={wordSet} />
              {title.length > 60 && <p className="text-xs text-destructive mt-1">Слишком длинный (&gt;60)</p>}
            </Field>
            <Field label={`Description (${desc.length} симв.)`} used={usedInText(desc)} words={wordSet}>
              <Textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
              <Highlighted text={desc} words={wordSet} />
              {desc.length > 160 && <p className="text-xs text-destructive mt-1">Слишком длинный (&gt;160)</p>}
            </Field>

            <div className="flex items-center gap-2 pt-2">
              <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
                <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_started">Не начато</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="done">Завершено</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={save}>Сохранить</Button>
            </div>

            {history.length > 0 && (
              <div className="pt-4">
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">История изменений</div>
                <ul className="space-y-1 text-xs">
                  {history.map((h, i) => (
                    <li key={i} className="border-l-2 border-border pl-2">
                      <span className="text-muted-foreground">{new Date(h.at).toLocaleString()} · {h.field}: </span>
                      <span className="line-through text-muted-foreground">{h.oldValue || "—"}</span>
                      {" → "}
                      <span>{h.newValue || "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="border-l border-border pl-4">
            <div className="text-xs uppercase text-muted-foreground mb-2">Покрытие Words</div>
            <div className="text-2xl font-semibold mb-1">{coverage}%</div>
            <div className="text-xs text-muted-foreground mb-3">{usedAll.size} из {wordSet.size} слов</div>
            <div className="max-h-96 overflow-auto text-xs space-y-1">
              {words.map((w) => (
                <div key={w.word} className="flex items-center justify-between">
                  <span className={usedAll.has(w.word) ? "text-chart-2 font-medium" : "text-muted-foreground"}>
                    {usedAll.has(w.word) ? "✔" : "○"} {w.word}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{wordFreq.get(w.word) ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; used: Set<string>; words: Set<string>; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-muted-foreground mb-1 block">{label}</label>
      {children}
    </div>
  );
}

function Highlighted({ text, words }: { text: string; words: Set<string> }) {
  const seen = new Map<string, number>();
  const parts = text.split(/(\s+)/);
  return (
    <div className="mt-1 text-xs leading-relaxed">
      {parts.map((p, i) => {
        const norm = p.toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]/gi, "");
        if (!norm) return <span key={i}>{p}</span>;
        const isKw = words.has(norm);
        const count = (seen.get(norm) ?? 0) + 1;
        seen.set(norm, count);
        const repeated = count > 1;
        const cls = isKw
          ? repeated
            ? "bg-chart-4/40 rounded px-0.5"
            : "bg-chart-2/30 rounded px-0.5"
          : "text-muted-foreground";
        return <span key={i} className={cls}>{p}</span>;
      })}
    </div>
  );
}
