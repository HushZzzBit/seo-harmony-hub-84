// Нормализация и сопоставление внешних названий категорий (DataLens Base category)
// с группами сервиса (Topvisor groups). Чистая клиент-безопасная логика.
import type { Query } from "./types";

export type GroupMatchType = "exact" | "normalized" | "alias" | "manual";

export interface GroupTarget {
  folder: string | null;
  group: string;
}

export interface GroupResolution extends GroupTarget {
  match_type: GroupMatchType;
}

export interface AliasEntry {
  external_name_normalized: string;
  matched_group_id: string | null;
  matched_folder: string | null;
  match_type: string;
}

/** Нижний регистр, ё→е, схлопывание пробелов и пунктуации по краям. */
export function normalizeGroupName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Вариант без текста в скобках: "Google Drive (Гугл диск)" → "google drive". */
export function stripParens(s: string): string {
  return normalizeGroupName(s.replace(/\([^)]*\)/g, " "));
}

/** Содержимое скобок как отдельные alias-кандидаты. */
export function parensAliases(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\(([^)]*)\)/g)) {
    const v = normalizeGroupName(m[1]);
    if (v) out.push(v);
  }
  return out;
}

/** Все варианты написания внешнего названия для матчинга. */
export function nameVariants(raw: string): string[] {
  const set = new Set<string>();
  const n = normalizeGroupName(raw);
  if (n) set.add(n);
  const sp = stripParens(raw);
  if (sp) set.add(sp);
  for (const p of parensAliases(raw)) set.add(p);
  return Array.from(set);
}

export interface GroupResolver {
  /** Все известные группы сервиса (уникальные). */
  groups: GroupTarget[];
  resolve: (rawName: string | null | undefined) => GroupResolution | null;
}

/**
 * Строит резолвер: сначала точное/нормализованное совпадение с группой Topvisor,
 * затем alias-таблица (в т.ч. ручные привязки).
 */
export function buildGroupResolver(queries: Query[], aliases: AliasEntry[] = []): GroupResolver {
  const byNorm = new Map<string, GroupTarget>();
  const byStripped = new Map<string, GroupTarget>();
  const groups: GroupTarget[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    if (!q.group) continue;
    const target: GroupTarget = { folder: q.folder ?? null, group: q.group };
    const key = `${target.folder ?? ""}::${target.group}`;
    if (!seen.has(key)) {
      seen.add(key);
      groups.push(target);
    }
    const n = normalizeGroupName(q.group);
    if (n && !byNorm.has(n)) byNorm.set(n, target);
    const sp = stripParens(q.group);
    if (sp && !byStripped.has(sp)) byStripped.set(sp, target);
    for (const p of parensAliases(q.group)) if (!byStripped.has(p)) byStripped.set(p, target);
  }

  const aliasMap = new Map<string, { target: GroupTarget; type: GroupMatchType }>();
  for (const a of aliases) {
    if (!a.matched_group_id) continue;
    aliasMap.set(a.external_name_normalized, {
      target: { folder: a.matched_folder ?? byNorm.get(normalizeGroupName(a.matched_group_id))?.folder ?? null, group: a.matched_group_id },
      type: a.match_type === "manual" ? "manual" : "alias",
    });
  }

  const resolve = (rawName: string | null | undefined): GroupResolution | null => {
    if (!rawName) return null;
    const variants = nameVariants(rawName);
    const norm = variants[0];

    // 1. Ручные/alias привязки имеют приоритет — они заданы человеком.
    for (const v of variants) {
      const hit = aliasMap.get(v);
      if (hit) return { ...hit.target, match_type: hit.type };
    }
    // 2. Точное совпадение с названием группы.
    const exact = byNorm.get(norm);
    if (exact) return { ...exact, match_type: "exact" };
    // 3. Нормализованные варианты (без скобок / содержимое скобок).
    for (const v of variants) {
      const hit = byNorm.get(v) ?? byStripped.get(v);
      if (hit) return { ...hit, match_type: "normalized" };
    }
    return null;
  };

  return { groups, resolve };
}
