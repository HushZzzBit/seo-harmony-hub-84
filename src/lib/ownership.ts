// Клиент-безопасный расчёт единого реестра владения URL.
// Источники (по убыванию приоритета):
//   100 datalens_base   — DataLens Categories.base_category → Topvisor group
//    80 datalens_match  — matched_group_id из импортов DataLens
//    60 tv_relevant     — Topvisor: relevantGoogle / relevantYandex
//    40 tv_target       — Topvisor: targetUrl / url
// Победитель — самая частая (folder, group) в максимальном тир‑уровне.
import { normalizeUrl } from "./datalens";
import type { Query } from "./types";

export interface OwnershipRow {
  folder: string | null;
  group: string | null;
  source: string;
  confidence: number;
  hits: number;
}

interface CatVoteInput {
  normalized_url: string | null;
  base_category?: string | null;
  matched_group_id?: string | null;
}
interface UrlVoteInput {
  normalized_url: string | null;
  matched_group_id?: string | null;
}

interface Vote {
  folder: string | null;
  group: string | null;
  conf: number;
  source: string;
}

const normName = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Индекс: имя группы (нижний регистр) → {folder, group} из Topvisor queries. */
export function buildGroupNameIndex(queries: Query[]): Map<string, { folder: string | null; group: string }> {
  const m = new Map<string, { folder: string | null; group: string }>();
  for (const q of queries) {
    if (!q.group) continue;
    const k = normName(q.group);
    if (!m.has(k)) m.set(k, { folder: q.folder ?? null, group: q.group });
  }
  return m;
}

/** Множество нормализованных URL, встречающихся в Topvisor (для intersect). */
export function buildTopvisorUrlSet(queries: Query[]): Set<string> {
  const s = new Set<string>();
  const add = (u: string | undefined | null) => {
    const n = normalizeUrl(u ?? null);
    if (n) s.add(n);
  };
  for (const q of queries) {
    add(q.url);
    add(q.targetUrl);
    add(q.relevantGoogle);
    add(q.relevantYandex);
  }
  return s;
}

export function computeOwnership(
  queries: Query[],
  categories: CatVoteInput[],
  startUrls: UrlVoteInput[],
): Record<string, OwnershipRow> {
  const groupByName = buildGroupNameIndex(queries);
  const votes = new Map<string, Vote[]>();
  const push = (norm: string | null | undefined, v: Vote) => {
    if (!norm) return;
    const arr = votes.get(norm) ?? [];
    arr.push(v);
    votes.set(norm, arr);
  };

  // 100: DataLens base_category → Topvisor group
  for (const c of categories) {
    const bc = c.base_category ? normName(c.base_category) : "";
    const hit = bc ? groupByName.get(bc) : undefined;
    if (hit) push(c.normalized_url, { folder: hit.folder, group: hit.group, conf: 100, source: "datalens_base" });
  }
  // 80: DataLens matched_group_id
  for (const c of categories) {
    if (c.matched_group_id) push(c.normalized_url, { folder: null, group: c.matched_group_id, conf: 80, source: "datalens_match" });
  }
  for (const u of startUrls) {
    if (u.matched_group_id) push(u.normalized_url, { folder: null, group: u.matched_group_id, conf: 80, source: "datalens_match" });
  }
  // 60: Topvisor relevant
  // 40: Topvisor target/url
  for (const q of queries) {
    const g = q.group ?? null;
    const f = q.folder ?? null;
    if (q.relevantGoogle) push(normalizeUrl(q.relevantGoogle), { folder: f, group: g, conf: 60, source: "tv_relevant" });
    if (q.relevantYandex) push(normalizeUrl(q.relevantYandex), { folder: f, group: g, conf: 60, source: "tv_relevant" });
    if (q.targetUrl) push(normalizeUrl(q.targetUrl), { folder: f, group: g, conf: 40, source: "tv_target" });
    if (q.url && !q.relevantGoogle && !q.relevantYandex && !q.targetUrl) {
      push(normalizeUrl(q.url), { folder: f, group: g, conf: 40, source: "tv_target" });
    }
  }

  const out: Record<string, OwnershipRow> = {};
  for (const [norm, arr] of votes) {
    if (!arr.length) continue;
    const maxConf = Math.max(...arr.map((v) => v.conf));
    const top = arr.filter((v) => v.conf === maxConf);
    // mode по (folder|group)
    const counts = new Map<string, { v: Vote; n: number }>();
    for (const v of top) {
      const key = `${v.folder ?? ""}::${v.group ?? ""}`;
      const prev = counts.get(key) ?? { v, n: 0 };
      prev.n += 1;
      counts.set(key, prev);
    }
    const best = Array.from(counts.values()).sort((a, b) => b.n - a.n)[0];
    // backfill folder из голосов нижних тиров, если у лидера folder=null
    let folder = best.v.folder;
    if (!folder) {
      const withFolder = arr.find((v) => v.folder && v.group === best.v.group);
      if (withFolder) folder = withFolder.folder;
    }
    out[norm] = { folder, group: best.v.group, source: best.v.source, confidence: best.v.conf, hits: best.n };
  }
  return out;
}
