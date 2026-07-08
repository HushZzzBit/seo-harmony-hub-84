import type { Query, UrlRow, MetaEdit, Priority } from "./types";

export const MONTHS = [
  "Янв", "Фев", "Мар", "Апр", "Май", "Июн",
  "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек",
];

export function tokenize(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^a-zа-я0-9]+/i)
    .filter((w) => w && w.length > 1);
}

export function extractWords(phrases: string[]): { word: string; count: number }[] {
  const map = new Map<string, number>();
  for (const p of phrases) {
    for (const w of new Set(tokenize(p))) map.set(w, (map.get(w) ?? 0) + 1);
  }
  return Array.from(map, ([word, count]) => ({ word, count })).sort(
    (a, b) => b.count - a.count,
  );
}

export function groupSeasonality(queries: Query[]): number[] {
  const out = new Array(12).fill(0);
  for (const q of queries) {
    for (let i = 0; i < 12; i++) out[i] += (q.seasonality?.[i] ?? 0) * (q.frequency || 1);
  }
  return out;
}

/** Returns month index of peak season */
export function peakMonth(seasonality: number[]): number {
  let idx = 0;
  for (let i = 1; i < seasonality.length; i++) if (seasonality[i] > seasonality[idx]) idx = i;
  return idx;
}

/** Recommended month to start work = 2 months before peak */
export function recommendedMonth(seasonality: number[]): number {
  const p = peakMonth(seasonality);
  return (p - 2 + 12) % 12;
}

export function priorityForGroup(seasonality: number[]): Priority {
  const now = new Date().getMonth();
  const rec = recommendedMonth(seasonality);
  const dist = (rec - now + 12) % 12;
  if (dist <= 1) return "high";
  if (dist <= 3) return "medium";
  return "low";
}

export function avg(nums: number[]): number {
  const v = nums.filter((n) => Number.isFinite(n) && n > 0);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

export function pct(part: number, total: number): number {
  return total ? Math.round((part / total) * 1000) / 10 : 0;
}

export function metaFor(url: string, urls: Record<string, UrlRow>, edits: Record<string, MetaEdit>) {
  const base = urls[url] ?? { url };
  const e = edits[url] ?? {};
  return {
    title: e.title ?? base.title ?? "",
    description: e.description ?? base.description ?? "",
    h1: e.h1 ?? base.h1 ?? "",
    edited: !!e.updatedAt,
    updatedAt: e.updatedAt,
    orig: base,
    edit: e,
  };
}
