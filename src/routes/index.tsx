import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
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
  const { queries, urls, metaEdits, texts, folderState, setFolderState } = useStore();

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
    };
  }, [queries, urls, metaEdits]);

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
        <Kpi label="Без текста" value={kpi.noText} tone="destructive" />
        <Kpi label="Без Meta" value={kpi.noMeta} tone="destructive" />
        <Kpi label="Готовых" value={kpi.ready} tone="good" />
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
              state={folderState[folder]}
              onChangeStatus={(s) => setFolderState(folder, { status: s })}
              onChangePlan={(d) => setFolderState(folder, { plannedDate: d })}
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

function FolderCard({
  folder, qs, urls, metaEdits, texts, state, onChangeStatus, onChangePlan,
}: {
  folder: string;
  qs: ReturnType<typeof useStore.getState>["queries"];
  urls: ReturnType<typeof useStore.getState>["urls"];
  metaEdits: ReturnType<typeof useStore.getState>["metaEdits"];
  texts: ReturnType<typeof useStore.getState>["texts"];
  state?: { status: Status; plannedDate?: string };
  onChangeStatus: (s: Status) => void;
  onChangePlan: (d: string) => void;
}) {
  const groups = new Set(qs.map((q) => q.group));
  const urlSet = new Set(qs.map((q) => q.url).filter(Boolean)) as Set<string>;
  const gPos = qs.map((q) => q.googlePosition ?? 0);
  const yPos = qs.map((q) => q.yandexPosition ?? 0);
  const top3G = qs.filter((q) => (q.googlePosition ?? 999) <= 3).length;
  const top10G = qs.filter((q) => (q.googlePosition ?? 999) <= 10).length;
  const top3Y = qs.filter((q) => (q.yandexPosition ?? 999) <= 3).length;
  const top10Y = qs.filter((q) => (q.yandexPosition ?? 999) <= 10).length;
  const metaDone = Array.from(urlSet).filter((u) => metaEdits[u]?.title).length;
  const textDone = Array.from(urlSet).filter((u) => texts[u]?.status === "ready" || texts[u]?.status === "published").length;
  const seasonality = groupSeasonality(qs);
  const chartData = seasonality.map((v, i) => ({ month: MONTHS[i], value: Math.round(v) }));
  const peak = peakMonth(seasonality);
  const rec = recommendedMonth(seasonality);
  const status: Status = state?.status ?? "not_started";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{folder}</CardTitle>
            <div className="text-xs text-muted-foreground mt-1">
              {groups.size} групп · {urlSet.size} URL · {qs.length} запросов
            </div>
          </div>
          <Badge className={statusColor[status]}>{statusLabel[status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-4 gap-2 text-xs">
          <Metric label="Ср. G" value={avg(gPos).toFixed(1)} />
          <Metric label="Ср. Y" value={avg(yPos).toFixed(1)} />
          <Metric label="TOP3 G" value={`${pct(top3G, qs.length)}%`} />
          <Metric label="TOP10 G" value={`${pct(top10G, qs.length)}%`} />
          <Metric label="TOP3 Y" value={`${pct(top3Y, qs.length)}%`} />
          <Metric label="TOP10 Y" value={`${pct(top10Y, qs.length)}%`} />
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
        <div className="flex items-center gap-2 pt-1">
          <Select value={status} onValueChange={(v) => onChangeStatus(v as Status)}>
            <SelectTrigger className="h-8 text-xs w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="not_started">Не начато</SelectItem>
              <SelectItem value="in_progress">В работе</SelectItem>
              <SelectItem value="done">Завершено</SelectItem>
            </SelectContent>
          </Select>
          <input
            type="date"
            className="h-8 text-xs px-2 rounded-md border border-input bg-background"
            value={state?.plannedDate ?? ""}
            onChange={(e) => onChangePlan(e.target.value)}
          />
        </div>
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
