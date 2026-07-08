import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  ready: "Готов",
  published: "Опубликовано",
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
                <th className="text-left p-2">Продукт</th>
                <th className="text-center p-2">Текст</th>
                <th className="text-right p-2">Длина</th>
                <th className="text-right p-2">План</th>
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
                const has = uRow?.hasText;
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
                    <td className="p-2 align-top">
                      <Input value={t.productName ?? ""} onChange={(e) => setText(r.url, { productName: e.target.value })} className="h-7 text-xs w-32" />
                    </td>
                    <td className="p-2 align-top text-center text-lg">{has ? "🟢" : "🔴"}</td>
                    <td className="p-2 align-top text-right">{uRow?.textLength ?? 0}</td>
                    <td className="p-2 align-top text-right">
                      <Input type="number" value={t.plannedLength ?? ""} onChange={(e) => setText(r.url, { plannedLength: Number(e.target.value) || undefined })} className="h-7 text-xs w-20 text-right" />
                    </td>
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
                <tr><td colSpan={10} className="p-8 text-center text-muted-foreground">Нет строк.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function TextEditor({ url, folder, group }: { url: string; folder: string; group: string }) {
  const { texts, setText, urls } = useStore();
  const [open, setOpen] = useState(false);
  const t = texts[url] ?? { url, status: "not_assigned" as TextStatus };
  const [value, setValue] = useState(t.text ?? urls[url]?.text ?? "");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Текст</Button></DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{folder} / {group}</DialogTitle>
          <div className="text-xs font-mono text-muted-foreground truncate">{url}</div>
        </DialogHeader>
        <Textarea rows={20} value={value} onChange={(e) => setValue(e.target.value)} className="font-mono text-sm" />
        <div className="flex justify-between items-center">
          <span className="text-xs text-muted-foreground">{value.length} символов</span>
          <Button onClick={() => { setText(url, { text: value }); setOpen(false); }}>Сохранить</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
