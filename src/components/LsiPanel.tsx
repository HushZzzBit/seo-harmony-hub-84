import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Play, RefreshCw, Sparkles, Save, Trash2, Plus, Check, History } from "lucide-react";
import { toast } from "sonner";
import { useStore } from "@/lib/store";
import { groupSeasonality, MONTHS, recommendedMonth, priorityForGroup } from "@/lib/seo";
import { priorityLabel, priorityRank, priorityStyle } from "@/lib/ui";
import type { Priority, Query } from "@/lib/types";
import {
  getLsiSettings,
  setLsiSettings,
  listAnalyses,
  getAnalysis,
  collectCompetitors,
  runMiratext,
  pollMiratext,
  updateCompetitor,
  addCompetitor,
  deleteCompetitor,
  upsertItem,
  deleteItem,
  approveVersion,
  listVersions,
  rollbackToVersion,
  type AnalysisRow,
  type LsiCompetitor,
  type LsiItem,
  type LsiItemType,
  type VersionRow,
} from "@/lib/lsi.functions";

const STATUS_LABEL: Record<string, string> = {
  draft: "Черновик",
  collecting_serp: "Сбор SERP…",
  competitors_found: "Конкуренты собраны",
  analyzing_miratext: "Анализ Miratext…",
  ready_for_review: "Готово к проверке",
  approved: "Утверждено",
  failed: "Ошибка",
};

export function LsiPanel() {
  const queries = useStore((s) => s.queries);
  const listA = useServerFn(listAnalyses);
  const [analyses, setAnalyses] = useState<AnalysisRow[]>([]);
  const [folderFilter, setFolderFilter] = useState("all");
  const [prioFilter, setPrioFilter] = useState<"all" | Priority>("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(20);
  const PAGE_SIZE = 20;

  async function reloadAll() {
    const a = await listA();
    setAnalyses(a);
  }
  useEffect(() => {
    reloadAll().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [folderFilter, prioFilter, search]);


  // groups from local store (folder::group), enriched with seasonality/priority
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; folder: string; group: string; url: string; keywords: string[]; qs: Query[] }
    >();
    for (const q of queries) {
      const key = `${q.folder}::${q.group}`;
      if (!map.has(key)) map.set(key, { key, folder: q.folder, group: q.group, url: q.url ?? "", keywords: [], qs: [] });
      const g = map.get(key)!;
      g.keywords.push(q.phrase);
      g.qs.push(q);
    }
    const now = new Date().getMonth();
    return Array.from(map.values()).map((g) => {
      const season = groupSeasonality(g.qs);
      const planMonth = recommendedMonth(season);
      const prio = priorityForGroup(season);
      const dist = (planMonth - now + 12) % 12;
      return { ...g, season, planMonth, prio, dist, hasSeason: season.some((v) => v > 0) };
    });
  }, [queries]);

  const folders = useMemo(() => Array.from(new Set(groups.map((g) => g.folder))).sort(), [groups]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .filter((g) => folderFilter === "all" || g.folder === folderFilter)
      .filter((g) => prioFilter === "all" || g.prio === prioFilter)
      .filter((g) => !q || g.group.toLowerCase().includes(q) || g.folder.toLowerCase().includes(q) || g.url.toLowerCase().includes(q))
      .sort((a, b) => {
        const d = priorityRank[a.prio] - priorityRank[b.prio];
        if (d !== 0) return d;
        if (a.hasSeason !== b.hasSeason) return a.hasSeason ? -1 : 1;
        if (a.dist !== b.dist) return a.dist - b.dist;
        return (a.folder + a.group).localeCompare(b.folder + b.group);
      });
  }, [groups, folderFilter, prioFilter, search]);

  const slicedGroups = useMemo(() => visibleGroups.slice(0, limit), [visibleGroups, limit]);

  const byGroup = useMemo(() => {
    const m = new Map<string, AnalysisRow>();
    for (const a of analyses) if (!m.has(a.group_key)) m.set(a.group_key, a);
    return m;
  }, [analyses]);

  async function saveSettings(patch: Partial<NonNullable<typeof settings>>) {
    const next = await setS({ data: { folder: settingsScope, patch } as never });
    setSettings(next);
  }

  if (!settings) {
    return <div className="text-xs text-muted-foreground">Загрузка настроек LSI…</div>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <div className="text-sm font-medium">LSI и конкуренты</div>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Стрим:</span>
              <Select value={settingsScope} onValueChange={setSettingsScope}>
                <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">Глобально (по умолчанию)</SelectItem>
                  {folders.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            Автоматический сбор конкурентов из SERP (Topvisor) и анализ через Miratext.
            Требуются ключи <code>TOPVISOR_USER_ID</code>, <code>TOPVISOR_API_KEY</code>, <code>MIRATEXT_API_KEY</code> во вкладке API и Ключи.
            {settingsScope !== "__default" && <span className="block mt-1">Настройки применяются к стриму <b>{settingsScope}</b>. Пустые поля наследуются из глобальных.</span>}
          </div>


          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="Topvisor project_id">
              <Input
                value={settings.topvisor_project_id ?? ""}
                onChange={(e) => setSettings({ ...settings, topvisor_project_id: e.target.value })}
                onBlur={() => saveSettings({ topvisor_project_id: settings.topvisor_project_id })}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Поисковик (ПС)">
              <Select
                value={settings.search_engine}
                onValueChange={(v) => { setSettings({ ...settings, search_engine: v }); saveSettings({ search_engine: v }); }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="yandex">Yandex</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Глубина SERP">
              <Select
                value={String(settings.serp_depth)}
                onValueChange={(v) => { setSettings({ ...settings, serp_depth: Number(v) }); saveSettings({ serp_depth: Number(v) }); }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">TOP-10</SelectItem>
                  <SelectItem value="20">TOP-20</SelectItem>
                  <SelectItem value="30">TOP-30</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Кол-во конкурентов">
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.competitor_count}
                onChange={(e) => setSettings({ ...settings, competitor_count: Number(e.target.value) || 3 })}
                onBlur={() => saveSettings({ competitor_count: settings.competitor_count })}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Домен проекта (исключить)">
              <Input
                value={settings.project_domain}
                onChange={(e) => setSettings({ ...settings, project_domain: e.target.value })}
                onBlur={() => saveSettings({ project_domain: settings.project_domain })}
                className="h-8 text-xs"
              />
            </Field>
            <Field label="Blacklist доменов (через запятую)" className="col-span-2">
              <Input
                value={blDraft}
                onChange={(e) => setBlDraft(e.target.value)}
                onBlur={() => {
                  const list = blDraft.split(",").map((x) => x.trim()).filter(Boolean);
                  setSettings({ ...settings, blacklist_domains: list });
                  saveSettings({ blacklist_domains: list });
                }}
                className="h-8 text-xs"
              />
            </Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={folderFilter} onValueChange={setFolderFilter}>
              <SelectTrigger className="h-8 text-xs w-[180px]"><SelectValue placeholder="Стрим (папка)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все стримы</SelectItem>
                {folders.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={prioFilter} onValueChange={(v) => setPrioFilter(v as "all" | Priority)}>
              <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue placeholder="Приоритет" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Любой приоритет</SelectItem>
                <SelectItem value="high">Высокий</SelectItem>
                <SelectItem value="medium">Средний</SelectItem>
                <SelectItem value="low">Низкий</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по группе / URL"
              className="h-8 text-xs w-[240px]"
            />
            <div className="ml-auto text-[11px] text-muted-foreground">
              Показано: {visibleGroups.length} из {groups.length}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-xs">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-2 w-24">Приоритет</th>
                  <th className="text-left px-2 py-2">Папка / Группа</th>
                  <th className="text-left px-2 py-2">URL</th>
                  <th className="text-right px-2 py-2">Ключей</th>
                  <th className="text-left px-2 py-2">План. мес.</th>
                  <th className="text-left px-2 py-2">Статус</th>
                  <th className="text-left px-2 py-2">Обновлено</th>
                  <th className="text-right px-2 py-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {slicedGroups.map((g) => (
                  <GroupRow
                    key={g.key}
                    g={g}
                    analysis={byGroup.get(g.key)}
                    onChanged={reloadAll}
                  />
                ))}
                {slicedGroups.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">
                    {groups.length === 0 ? "Нет групп. Импортируйте данные во вкладке Импорт." : "Нет групп под текущие фильтры."}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {limit < visibleGroups.length && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setLimit((prev) => prev + PAGE_SIZE)}
                className="h-8 text-xs"
              >
                Показать ещё {Math.min(PAGE_SIZE, visibleGroups.length - limit)}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-xs ${className}`}>
      <span className="text-muted-foreground text-[11px]">{label}</span>
      {children}
    </label>
  );
}

function GroupRow({
  g,
  analysis,
  onChanged,
}: {
  g: { key: string; folder: string; group: string; url: string; keywords: string[]; prio: Priority; planMonth: number; hasSeason: boolean };
  analysis: AnalysisRow | undefined;
  onChanged: () => Promise<void>;
}) {
  const collect = useServerFn(collectCompetitors);
  const run = useServerFn(runMiratext);
  const poll = useServerFn(pollMiratext);
  const approve = useServerFn(approveVersion);
  const listV = useServerFn(listVersions);
  const [busy, setBusy] = useState<string>("");
  const [editOpen, setEditOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);

  const st = analysis?.status ?? "—";
  const badgeCls =
    st === "approved" ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
    : st === "ready_for_review" ? "bg-sky-500/15 text-sky-600 border-sky-500/30"
    : st === "failed" ? "bg-rose-500/15 text-rose-600 border-rose-500/30"
    : "bg-muted text-muted-foreground border-border";

  async function doCollect() {
    setBusy("collect");
    try {
      const res = await collect({
        data: {
          group_key: g.key,
          folder: g.folder,
          group_name: g.group,
          target_url: g.url,
          keywords: Array.from(new Set(g.keywords)).slice(0, 30),
        },
      });
      toast.success(`Найдено конкурентов: ${res.competitorsFound}`);
      await onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  }

  async function doRun() {
    if (!analysis) return;
    setBusy("run");
    try {
      await run({ data: { analysisId: analysis.id } });
      toast.success("Анализ Miratext запущен, ожидание результата…");
      // poll a few times
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const res = await poll({ data: { analysisId: analysis.id } });
        if (res.status === "ready") { toast.success(`Анализ завершён (LSI: ${res.itemsCount})`); break; }
        if (res.status === "failed") { toast.error(res.error ?? "Miratext failed"); break; }
      }
      await onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  }

  async function doApproveLatest() {
    if (!analysis) return;
    setBusy("approve");
    try {
      const versions = await listV({ data: { group_key: g.key } });
      const draft = versions.find((v) => v.status === "draft") ?? versions[0];
      if (!draft) throw new Error("Нет версии для утверждения");
      await approve({ data: { versionId: draft.id } });
      toast.success("Версия утверждена");
      await onChanged();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(""); }
  }

  const prioClass = priorityStyle[g.prio];
  const isCurrent = g.planMonth === new Date().getMonth();
  const rowAccent = g.prio === "high" ? "bg-rose-500/5" : g.prio === "medium" ? "bg-amber-500/5" : "";

  return (
    <tr className={`border-t border-border hover:bg-muted/30 align-middle ${rowAccent}`}>
      <td className="px-2 py-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] ${prioClass}`}>
          {priorityLabel[g.prio]}
        </span>
      </td>
      <td className="px-2 py-2">
        <div className="text-[10px] text-muted-foreground">{g.folder}</div>
        <div className="font-medium">{g.group}</div>
      </td>
      <td className="px-2 py-2 font-mono text-[11px] truncate max-w-[280px]">{g.url || "—"}</td>
      <td className="px-2 py-2 text-right">{g.keywords.length}</td>
      <td className="px-2 py-2 text-[11px]">
        {g.hasSeason ? (
          <span className={isCurrent ? "font-semibold text-primary" : "text-foreground"}>{MONTHS[g.planMonth]}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-2 py-2">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] ${badgeCls}`}>
          {STATUS_LABEL[st] ?? st}
        </span>
        {analysis?.error_message && <div className="text-[10px] text-rose-500 mt-0.5 max-w-[240px] truncate" title={analysis.error_message}>{analysis.error_message}</div>}
      </td>
      <td className="px-2 py-2 text-[11px] text-muted-foreground">{analysis ? new Date(analysis.updated_at).toLocaleString() : "—"}</td>
      <td className="px-2 py-2">
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="outline" onClick={doCollect} disabled={!!busy}>
            {busy === "collect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            <span className="hidden md:inline ml-1">Конкуренты</span>
          </Button>
          <Button size="sm" variant="outline" onClick={doRun} disabled={!analysis || !!busy}>
            {busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            <span className="hidden md:inline ml-1">Анализ</span>
          </Button>
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" disabled={!analysis}>
                <Sparkles className="h-3.5 w-3.5" />
                <span className="hidden md:inline ml-1">Редакт.</span>
              </Button>
            </DialogTrigger>
            {editOpen && analysis && (
              <RequirementsEditor analysisId={analysis.id} onSaved={onChanged} onClose={() => setEditOpen(false)} />
            )}
          </Dialog>
          <Button size="sm" variant="default" onClick={doApproveLatest} disabled={!analysis || !!busy}>
            {busy === "approve" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            <span className="hidden md:inline ml-1">Утвердить</span>
          </Button>
          <Dialog open={histOpen} onOpenChange={setHistOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost">
                <History className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            {histOpen && <VersionsDialog groupKey={g.key} onChanged={onChanged} onClose={() => setHistOpen(false)} />}
          </Dialog>
        </div>
      </td>
    </tr>
  );
}

function RequirementsEditor({
  analysisId,
  onSaved,
  onClose,
}: {
  analysisId: string;
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const get = useServerFn(getAnalysis);
  const upd = useServerFn(updateCompetitor);
  const add = useServerFn(addCompetitor);
  const del = useServerFn(deleteCompetitor);
  const upsert = useServerFn(upsertItem);
  const delI = useServerFn(deleteItem);
  const [state, setState] = useState<{ analysis: AnalysisRow | null; competitors: LsiCompetitor[]; items: LsiItem[] } | null>(null);
  const [newComp, setNewComp] = useState("");
  const [newItemType, setNewItemType] = useState<LsiItemType>("word");
  const [newItemValue, setNewItemValue] = useState("");

  async function reload() { setState(await get({ data: { id: analysisId } })); }
  useEffect(() => { reload().catch((e) => toast.error((e as Error).message)); /* eslint-disable-next-line */ }, [analysisId]);

  if (!state) return <DialogContent><div className="p-6 text-sm">Загрузка…</div></DialogContent>;

  const groups: { title: string; type: LsiItemType }[] = [
    { title: "LSI-слова", type: "word" },
    { title: "Фразы 2 слова", type: "phrase_2" },
    { title: "Фразы 3 слова", type: "phrase_3" },
    { title: "Стоп-слова", type: "stopword" },
    { title: "Обязательные блоки", type: "block" },
    { title: "Примеры (хорошо)", type: "example_good" },
    { title: "Примеры (плохо)", type: "example_bad" },
    { title: "Заметки", type: "note" },
  ];

  return (
    <DialogContent className="max-w-[1100px] w-[95vw] max-h-[92vh] overflow-hidden flex flex-col p-0">
      <DialogHeader className="px-5 pt-4 pb-2 border-b">
        <DialogTitle className="text-base">Редактирование требований</DialogTitle>
        <div className="text-xs text-muted-foreground">{state.analysis?.folder} / {state.analysis?.group_name} · {state.analysis?.target_url}</div>
      </DialogHeader>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <section>
          <div className="text-sm font-medium mb-2">Конкуренты ({state.competitors.length})</div>
          <div className="space-y-1">
            {state.competitors.map((c) => (
              <div key={c.id} className="flex items-center gap-2 text-xs border rounded-md px-2 py-1">
                <input
                  type="checkbox"
                  checked={c.is_selected && !c.is_excluded}
                  onChange={async (e) => { await upd({ data: { id: c.id, patch: { is_selected: e.target.checked, is_excluded: !e.target.checked } } }); await reload(); }}
                />
                <span className="font-mono truncate flex-1">{c.url}</span>
                <span className="text-muted-foreground">поз. {c.position ?? "—"}</span>
                <button onClick={async () => { await del({ data: { id: c.id } }); await reload(); }} className="text-rose-500 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex gap-2 mt-1">
              <Input value={newComp} onChange={(e) => setNewComp(e.target.value)} placeholder="https://competitor.example/page" className="h-8 text-xs" />
              <Button
                size="sm"
                onClick={async () => { if (!newComp.trim()) return; await add({ data: { analysisId, url: newComp.trim() } }); setNewComp(""); await reload(); }}
              ><Plus className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        </section>

        {groups.map((grp) => {
          const rows = state.items.filter((i) => i.type === grp.type);
          return (
            <section key={grp.type}>
              <div className="text-sm font-medium mb-2">{grp.title} ({rows.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {rows.map((it) => (
                  <span key={it.id} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${it.status === "required" ? "border-emerald-500/40 bg-emerald-500/10" : "border-border bg-background"}`}>
                    {it.value}
                    {it.recommended_count ? <span className="opacity-60">×{it.recommended_count}</span> : null}
                    <button onClick={async () => { await delI({ data: { id: it.id } }); await reload(); }} className="text-rose-500 hover:text-rose-600 ml-0.5">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                {rows.length === 0 && <span className="text-[11px] text-muted-foreground">Пусто</span>}
              </div>
            </section>
          );
        })}

        <section className="border-t pt-3">
          <div className="text-sm font-medium mb-2">Добавить вручную</div>
          <div className="flex gap-2">
            <Select value={newItemType} onValueChange={(v) => setNewItemType(v as LsiItemType)}>
              <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {groups.map((g) => <SelectItem key={g.type} value={g.type}>{g.title}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input value={newItemValue} onChange={(e) => setNewItemValue(e.target.value)} placeholder="Значение…" className="h-8 text-xs" />
            <Button
              size="sm"
              onClick={async () => {
                if (!newItemValue.trim()) return;
                await upsert({ data: { analysisId, patch: { type: newItemType, value: newItemValue.trim(), status: "recommended", is_manual: true } } });
                setNewItemValue("");
                await reload();
              }}
            ><Save className="h-3.5 w-3.5" /></Button>
          </div>
        </section>
      </div>
      <div className="border-t p-3 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Закрыть</Button>
        <Button onClick={async () => { await onSaved(); onClose(); }}>Готово</Button>
      </div>
    </DialogContent>
  );
}

function VersionsDialog({ groupKey, onChanged, onClose }: { groupKey: string; onChanged: () => Promise<void>; onClose: () => void }) {
  const listV = useServerFn(listVersions);
  const rollback = useServerFn(rollbackToVersion);
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  useEffect(() => { listV({ data: { group_key: groupKey } }).then(setRows); /* eslint-disable-next-line */ }, [groupKey]);
  return (
    <DialogContent className="max-w-[560px]">
      <DialogHeader><DialogTitle>История версий</DialogTitle></DialogHeader>
      <div className="space-y-1 max-h-[60vh] overflow-auto">
        {(rows ?? []).map((v) => (
          <div key={v.id} className="flex items-center justify-between text-xs border rounded-md px-2 py-1.5">
            <span>v{v.version_number} · <span className="text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span></span>
            <span className={`px-2 py-0.5 rounded-full border text-[10px] ${v.status === "active" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-border bg-background text-muted-foreground"}`}>
              {v.status}
            </span>
            {v.status !== "active" && (
              <Button size="sm" variant="outline" onClick={async () => { await rollback({ data: { versionId: v.id } }); await onChanged(); onClose(); toast.success("Версия активирована"); }}>Активировать</Button>
            )}
          </div>
        ))}
        {rows && rows.length === 0 && <div className="text-xs text-muted-foreground p-3 text-center">Версий пока нет.</div>}
      </div>
    </DialogContent>
  );
}
