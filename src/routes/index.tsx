import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useStore } from "@/lib/store";
import { avg, groupSeasonality, MONTHS, pct, peakMonth, priorityForGroup, recommendedMonth } from "@/lib/seo";
import type { Status } from "@/lib/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientOnly } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  ssr: false,
  component: () => (
    <ClientOnly fallback={null}>
      <Dashboard />
    </ClientOnly>
  ),
});

const statusLabel: Record<Status, string> = {
  not_started: "Не начато",
  in_progress: "В работе",
  in_csv: "В файле CSV",
  done: "Завершено",
};
const statusColor: Record<Status, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-chart-4/20 text-foreground",
  in_csv: "bg-chart-1/20 text-foreground",
  done: "bg-chart-2/30 text-foreground",
};

function Dashboard() {
  const { queries, urls, metaEdits, texts } = useStore();

  const grouped = useMemo(() => {
    const byFolder = new Map<string, typeof queries>();
    for (const q of queries) {
      if (!byFolder.has(q.folder)) byFolder.set(q.folder, []);
      byFolder.get(q.folder)!.push(q);
    }
    return byFolder;
  }, [queries]);

  const kpi = useMemo(() => {
    const folders = new Set(queries.map((q) => q.folder));
    const groups = new Set(queries.map((q) => `${q.folder}::${q.group}`));
    const urlSet = new Set(queries.map((q) => q.url).filter(Boolean));
    const gPos = queries.map((q) => q.googlePosition ?? 0);
    const yPos = queries.map((q) => q.yandexPosition ?? 0);
    const top3G = queries.filter((q) => (q.googlePosition ?? 999) <= 3).length;
    const top10G = queries.filter((q) => (q.googlePosition ?? 999) <= 10).length;
    const noText = Array.from(urlSet).filter((u) => !(urls[u!]?.hasText)).length;
    const noMeta = Array.from(urlSet).filter((u) => {
      const r = urls[u!];
      const e = metaEdits[u!];
      return !(e?.title || r?.title);
    }).length;
    const doneMeta = Array.from(urlSet).filter((u) => metaEdits[u!]?.status === "done").length;
    const inCsvMeta = Array.from(urlSet).filter((u) => metaEdits[u!]?.status === "in_csv").length;
    const doneText = Array.from(urlSet).filter((u) => texts[u!]?.status === "done").length;
    const inCsvText = Array.from(urlSet).filter((u) => texts[u!]?.status === "in_csv").length;
    const ready = Array.from(urlSet).filter((u) => {
      const r = urls[u!]; const e = metaEdits[u!];
      return (e?.title || r?.title) && r?.hasText;
    }).length;
    return {
      folders: folders.size,
      groups: groups.size,
      urls: urlSet.size,
      avgPos: avg([...gPos, ...yPos]).toFixed(1),
      top3: pct(top3G, queries.length),
      top10: pct(top10G, queries.length),
      noText, noMeta, ready,
      doneMeta, inCsvMeta,
      doneText, inCsvText,
      donePct: pct(doneMeta, urlSet.size),
      donePctText: pct(doneText, urlSet.size),
    };
  }, [queries, urls, metaEdits, texts]);

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Общее состояние проекта</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3 mb-6">
        <Kpi label="Папки" value={kpi.folders} />
        <Kpi label="Группы" value={kpi.groups} />
        <Kpi label="URL" value={kpi.urls} />
        <Kpi label="Ср. позиция" value={kpi.avgPos} />
        <Kpi label="% TOP3" value={`${kpi.top3}%`} />
        <Kpi label="% TOP10" value={`${kpi.top10}%`} />
        <Kpi label="Meta: в CSV" value={kpi.inCsvMeta} />
        <Kpi label="Meta: готово" value={`${kpi.doneMeta} · ${kpi.donePct}%`} tone="good" />
        <Kpi label="Тексты: в CSV" value={kpi.inCsvText} />
        <Kpi label="Тексты: готово" value={`${kpi.doneText} · ${kpi.donePctText}%`} tone="good" />
        <Kpi label="Без Meta" value={kpi.noMeta} tone="destructive" />
        <Kpi label="Без текста" value={kpi.noText} tone="destructive" />
        <Kpi label="Запросов" value={queries.length} />
      </div>

      {grouped.size === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            Нет данных. Перейдите в раздел <span className="font-medium">Import / Export</span> и загрузите файлы Topvisor / Netpeak.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from(grouped.entries()).map(([folder, qs]) => (
            <FolderCard
              key={folder}
              folder={folder}
              qs={qs}
              urls={urls}
              metaEdits={metaEdits}
              texts={texts}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string | number; tone?: "destructive" | "good" }) {
  const color =
    tone === "destructive" ? "text-destructive" : tone === "good" ? "text-chart-2" : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${color}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function GroupsBreakdown({
  qs, metaEdits, texts, selectedGroup, onSelectGroup, folder, groupState,
}: {
  qs: ReturnType<typeof useStore.getState>["queries"];
  metaEdits: ReturnType<typeof useStore.getState>["metaEdits"];
  texts: ReturnType<typeof useStore.getState>["texts"];
  selectedGroup: string | null;
  onSelectGroup: (g: string | null) => void;
  folder: string;
  groupState: Record<string, { status: Status; plannedDate?: string }>;
}) {
  const [search, setSearch] = useState("");
  const lowerSearch = search.trim().toLowerCase();

  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof qs>();
    for (const q of qs) {
      if (!byGroup.has(q.group)) byGroup.set(q.group, []);
      byGroup.get(q.group)!.push(q);
    }
    return Array.from(byGroup.entries())
      .map(([group, items]) => {
        const urlSet = new Set(items.map((q) => q.url).filter(Boolean)) as Set<string>;
        const total = urlSet.size;
        const arr = Array.from(urlSet);
        const metaDone = arr.filter((u) => metaEdits[u]?.status === "done").length;
        const metaCsv = arr.filter((u) => metaEdits[u]?.status === "in_csv").length;
        const metaProg = arr.filter((u) => metaEdits[u]?.status === "in_progress").length;
        const textDone = arr.filter((u) => texts[u]?.status === "done").length;
        const textCsv = arr.filter((u) => texts[u]?.status === "in_csv").length;
        const textReady = arr.filter((u) => texts[u]?.status === "ready").length;
        const gPos = items.map((q) => q.googlePosition ?? 0);
        const yPos = items.map((q) => q.yandexPosition ?? 0);
        return {
          group, total, queries: items.length,
          metaDone, metaCsv, metaProg,
          textDone, textCsv, textReady,
          avgG: avg(gPos), avgY: avg(yPos),
        };
      })
      .sort((a, b) => a.group.localeCompare(b.group));
  }, [qs, metaEdits, texts]);

  const filteredGroups = useMemo(
    () => (lowerSearch ? groups.filter((g) => g.group.toLowerCase().includes(lowerSearch)) : groups),
    [groups, lowerSearch]
  );

  if (groups.length === 0) return null;

  return (
    <details className="group rounded-md border border-border/60 bg-muted/30 overflow-hidden" open={selectedGroup !== null}>
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium flex items-center justify-between hover:bg-muted/50">
        <span>
          Группы ({groups.length})
          {selectedGroup && (
            <span className="ml-2 text-muted-foreground font-normal">
              · выбрана: <b className="text-foreground">{selectedGroup}</b>
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {selectedGroup && (
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelectGroup(null); }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground"
            >
              Сбросить
            </button>
          )}
          <span className="text-muted-foreground group-open:rotate-180 transition-transform">▾</span>
        </span>
      </summary>
      <div className="px-3 pt-2 pb-1">
        <input
          type="text"
          placeholder="Поиск группы..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-7 text-xs px-2 rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="divide-y divide-border/60">
        {filteredGroups.map((g) => {
          const active = selectedGroup === g.group;
          return (
            <button
              key={g.group}
              type="button"
              onClick={() => onSelectGroup(active ? null : g.group)}
              className={`w-full text-left px-3 py-2 space-y-1.5 transition-colors ${
                active ? "bg-primary/10" : "hover:bg-muted/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className={`truncate ${active ? "font-semibold text-primary" : "font-medium"}`} title={g.group}>
                  {g.group}
                </span>
                <div className="flex items-center gap-1.5">
                  <Badge className={`text-[10px] px-1 py-0 h-4 ${statusColor[groupState[`${folder}::${g.group}`]?.status ?? "not_started"]}`}>
                    {statusLabel[groupState[`${folder}::${g.group}`]?.status ?? "not_started"]}
                  </Badge>
                  <span className="text-muted-foreground tabular-nums shrink-0">
                    {g.total} URL · {g.queries} зпр · G {g.avgG.toFixed(1)} · Y {g.avgY.toFixed(1)}
                  </span>
                </div>
              </div>
              <MiniBar label="Meta" total={g.total} done={g.metaDone} inCsv={g.metaCsv} inProgress={g.metaProg} />
              <MiniBar label="Тексты" total={g.total} done={g.textDone} inCsv={g.textCsv} inProgress={g.textReady} />
            </button>
          );
        })}
        {filteredGroups.length === 0 && (
          <div className="px-3 py-3 text-xs text-muted-foreground text-center">Нет совпадений</div>
        )}
      </div>
    </details>
  );
}


function MiniBar({
  label, total, done, inCsv, inProgress,
}: { label: string; total: number; done: number; inCsv: number; inProgress: number }) {
  const w = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-muted-foreground w-12 shrink-0">{label}</span>
      <div className="h-1.5 flex-1 rounded-full bg-muted/60 overflow-hidden flex">
        {total > 0 && (
          <>
            <div className="h-full bg-chart-2" style={{ width: w(done) }} />
            <div className="h-full bg-chart-1" style={{ width: w(inCsv) }} />
            <div className="h-full bg-chart-4" style={{ width: w(inProgress) }} />
          </>
        )}
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right shrink-0">
        {done}/{total}
      </span>
    </div>
  );
}


function FolderCard({
  folder, qs, urls, metaEdits, texts,
}: {
  folder: string;
  qs: ReturnType<typeof useStore.getState>["queries"];
  urls: ReturnType<typeof useStore.getState>["urls"];
  metaEdits: ReturnType<typeof useStore.getState>["metaEdits"];
  texts: ReturnType<typeof useStore.getState>["texts"];
}) {
  const { groupState, setGroupState } = useStore();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const filteredQs = useMemo(
    () => (selectedGroup ? qs.filter((q) => q.group === selectedGroup) : qs),
    [qs, selectedGroup],
  );
  const groups = new Set(qs.map((q) => q.group));
  const urlSet = new Set(filteredQs.map((q) => q.url).filter(Boolean)) as Set<string>;
  const gPosAll = filteredQs.map((q) => q.googlePosition).filter((v): v is number => typeof v === "number" && v > 0);
  const yPosAll = filteredQs.map((q) => q.yandexPosition).filter((v): v is number => typeof v === "number" && v > 0);
  const gPos = gPosAll;
  const yPos = yPosAll;
  const top3G = gPosAll.filter((p) => p <= 3).length;
  const top10G = gPosAll.filter((p) => p <= 10).length;
  const top3Y = yPosAll.filter((p) => p <= 3).length;
  const top10Y = yPosAll.filter((p) => p <= 10).length;
  const metaDone = Array.from(urlSet).filter((u) => metaEdits[u]?.title).length;
  const doneUrls = Array.from(urlSet).filter((u) => metaEdits[u]?.status === "done").length;
  const inCsvUrls = Array.from(urlSet).filter((u) => metaEdits[u]?.status === "in_csv").length;
  const inProgUrls = Array.from(urlSet).filter((u) => metaEdits[u]?.status === "in_progress").length;

  const textDone = Array.from(urlSet).filter((u) => texts[u]?.status === "done").length;
  const textInCsv = Array.from(urlSet).filter((u) => texts[u]?.status === "in_csv").length;
  const textReady = Array.from(urlSet).filter((u) => texts[u]?.status === "ready").length;
  const seasonality = groupSeasonality(filteredQs);
  const chartData = seasonality.map((v, i) => ({ month: MONTHS[i], value: Math.round(v) }));
  const peak = peakMonth(seasonality);
  const rec = recommendedMonth(seasonality);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {folder}
              {selectedGroup && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">/ {selectedGroup}</span>
              )}
            </CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              {selectedGroup ? "1" : groups.size} {selectedGroup ? "группа" : "групп"} · {urlSet.size} URL · {filteredQs.length} запросов
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ProgressStrip
          label="Meta"
          total={urlSet.size}
          done={doneUrls}
          inCsv={inCsvUrls}
          inProgress={inProgUrls}
        />
        <ProgressStrip
          label="Тексты"
          total={urlSet.size}
          done={textDone}
          inCsv={textInCsv}
          inProgress={textReady}
          inProgressLabel="Готов к выгрузке"
        />
        <GroupsBreakdown
          qs={qs}
          metaEdits={metaEdits}
          texts={texts}
          selectedGroup={selectedGroup}
          onSelectGroup={setSelectedGroup}
          folder={folder}
          groupState={groupState}
        />
        <div className="grid grid-cols-4 gap-2 text-xs">
          <Metric label="Ср. G" value={avg(gPos).toFixed(1)} />
          <Metric label="Ср. Y" value={avg(yPos).toFixed(1)} />
          <Metric label="TOP3 G" value={`${pct(top3G, filteredQs.length)}%`} />
          <Metric label="TOP10 G" value={`${pct(top10G, filteredQs.length)}%`} />
          <Metric label="TOP3 Y" value={`${pct(top3Y, filteredQs.length)}%`} />
          <Metric label="TOP10 Y" value={`${pct(top10Y, filteredQs.length)}%`} />
          <Metric label="Meta" value={`${metaDone}/${urlSet.size}`} />
          <Metric label="Text" value={`${textDone}/${urlSet.size}`} />
        </div>
        <div className="h-32 -mx-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={30} />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" fill="var(--primary)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Пик: <b className="text-foreground">{MONTHS[peak]}</b></span>
          <span>Старт работ: <b className="text-foreground">{MONTHS[rec]}</b></span>
          <span>Приоритет: <b className="text-foreground">{priorityForGroup(seasonality)}</b></span>
        </div>
        {selectedGroup && (
          <div className="flex items-center gap-2 pt-2 border-t border-border/60">
            <Badge className={statusColor[groupState[`${folder}::${selectedGroup}`]?.status ?? "not_started"]}>
              {statusLabel[groupState[`${folder}::${selectedGroup}`]?.status ?? "not_started"]}
            </Badge>
            <Select
              value={groupState[`${folder}::${selectedGroup}`]?.status ?? "not_started"}
              onValueChange={(v) => setGroupState(folder, selectedGroup, { status: v as Status })}
            >
              <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">Не начато</SelectItem>
                <SelectItem value="in_progress">В работе</SelectItem>
                <SelectItem value="in_csv">В файле CSV</SelectItem>
                <SelectItem value="done">Завершено</SelectItem>
              </SelectContent>
            </Select>
            <input
              type="date"
              className="h-8 text-xs px-2 rounded-md border border-input bg-background"
              value={groupState[`${folder}::${selectedGroup}`]?.plannedDate ?? ""}
              onChange={(e) => setGroupState(folder, selectedGroup, { plannedDate: e.target.value })}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md bg-muted px-2 py-1">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function ProgressStrip({
  label, total, done, inCsv, inProgress, inProgressLabel = "В работе",
}: {
  label: string;
  total: number;
  done: number;
  inCsv: number;
  inProgress: number;
  inProgressLabel?: string;
}) {
  const pctDone = total ? Math.round((done / total) * 100) : 0;
  const w = (n: number) => (total ? `${(n / total) * 100}%` : "0%");
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums font-medium">{done}/{total} · {pctDone}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-muted/60 overflow-hidden flex">
        {total > 0 && (
          <>
            <div className="h-full bg-chart-2" style={{ width: w(done) }} title={`Готово: ${done}`} />
            <div className="h-full bg-chart-1" style={{ width: w(inCsv) }} title={`В файле CSV: ${inCsv}`} />
            <div className="h-full bg-chart-4" style={{ width: w(inProgress) }} title={`${inProgressLabel}: ${inProgress}`} />
          </>
        )}
      </div>
      <div className="flex gap-3 text-[10px] text-muted-foreground mt-1">
        <span><span className="inline-block size-2 rounded-full bg-chart-2 mr-1 align-middle" />Готово {done}</span>
        <span><span className="inline-block size-2 rounded-full bg-chart-1 mr-1 align-middle" />В CSV {inCsv}</span>
        <span><span className="inline-block size-2 rounded-full bg-chart-4 mr-1 align-middle" />{inProgressLabel} {inProgress}</span>
      </div>
    </div>
  );
}
