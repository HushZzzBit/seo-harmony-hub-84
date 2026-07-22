import type { Priority, Status, TextStatus } from "./types";

/** Убирает HTML-теги, схлопывает пробелы. */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

/** Цветовая классификация средней позиции в SERP. */
export function posColor(p: number | undefined | null): string {
  if (!p) return "text-muted-foreground";
  if (p <= 10) return "text-chart-2";
  if (p <= 30) return "text-chart-4";
  return "text-destructive";
}

export const priorityRank: Record<Priority, number> = { high: 0, medium: 1, low: 2 };
export const priorityLabel: Record<Priority, string> = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};
export const priorityStyle: Record<Priority, string> = {
  high: "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
  low: "bg-muted text-muted-foreground border-border",
};

export const metaStatusLabel: Record<Status, string> = {
  not_started: "Не начато",
  in_progress: "В работе",
  in_csv: "В файле CSV",
  done: "Готово",
};

export const metaStatusColor: Record<Status, string> = {
  not_started: "bg-muted text-muted-foreground",
  in_progress: "bg-chart-4/20 text-foreground",
  in_csv: "bg-chart-1/20 text-foreground",
  done: "bg-chart-2/30 text-foreground",
};

export const textStatusLabel: Record<TextStatus, string> = {
  not_assigned: "Не назначено",
  copywriting: "Копирайтинг",
  expansion: "Расширение",
  revision: "Доработка",
  ready: "Готов к выгрузке",
  in_csv: "В файле CSV",
  done: "Готово",
};

/** Нормализуем устаревшие значения TextStatus (совместимость со старым store). */
export function normTextStatus(s: string | undefined): TextStatus {
  if (s === "in_progress") return "copywriting";
  if (s === "review") return "revision";
  return (s as TextStatus) ?? "not_assigned";
}
