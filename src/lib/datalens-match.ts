// Pure client-safe URL matching for DataLens rows.
export type UrlMatchSource = "relevant_g" | "relevant_y" | "target";

export interface UrlMatchInput {
  url: string;
  normalized: string | null;
  folder: string | null;
  group: string | null;
  source: UrlMatchSource;
}

export interface NameHint {
  /** All tokens from the folder/group name MUST be present in the URL. */
  tokens: string[];
  folder: string | null;
  group: string | null;
}

export type SePriority = "any" | "google" | "yandex";

export interface MatchIndex {
  byNormRelevantG: Map<string, UrlMatchInput[]>;
  byNormRelevantY: Map<string, UrlMatchInput[]>;
  byNormTarget: Map<string, UrlMatchInput[]>;
  bySlug: Map<string, UrlMatchInput[]>;
  hints: NameHint[];
}

export interface MatchResult {
  matched_url_id: string | null;
  matched_group_id: string | null;
  match_status: string;
}

export function buildMatchIndex(seoUrls: UrlMatchInput[], hints: NameHint[]): MatchIndex {
  const byNormRelevantG = new Map<string, UrlMatchInput[]>();
  const byNormRelevantY = new Map<string, UrlMatchInput[]>();
  const byNormTarget = new Map<string, UrlMatchInput[]>();
  const bySlug = new Map<string, UrlMatchInput[]>();
  const push = (m: Map<string, UrlMatchInput[]>, k: string, u: UrlMatchInput) => {
    const a = m.get(k) ?? []; a.push(u); m.set(k, a);
  };
  for (const u of seoUrls) {
    if (u.normalized) {
      if (u.source === "relevant_g") push(byNormRelevantG, u.normalized, u);
      else if (u.source === "relevant_y") push(byNormRelevantY, u.normalized, u);
      else if (u.source === "target") push(byNormTarget, u.normalized, u);
    }
    const slug = (u.normalized ?? "").split("/").filter(Boolean).pop() ?? "";
    if (slug) push(bySlug, slug, u);
  }
  return { byNormRelevantG, byNormRelevantY, byNormTarget, bySlug, hints };
}

function tokenize(norm: string): string[] {
  return norm.split(/[/\-_.]/).map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
}

function pickFromEntries(entries: UrlMatchInput[], status: string): MatchResult {
  const uniqueGroups = new Set(entries.map((u) => `${u.folder}::${u.group}`));
  return {
    matched_url_id: entries[0].url,
    matched_group_id: entries[0].group,
    match_status: uniqueGroups.size > 1 ? "group_conflict" : status,
  };
}

export function matchOne(norm: string | null, idx: MatchIndex, sePriority: SePriority): MatchResult {
  if (!norm) return { matched_url_id: null, matched_group_id: null, match_status: "unmatched" };
  const rgFirst = sePriority !== "yandex";
  const relOrder: Array<[Map<string, UrlMatchInput[]>, string]> = rgFirst
    ? [[idx.byNormRelevantG, "matched_by_relevant_g"], [idx.byNormRelevantY, "matched_by_relevant_y"]]
    : [[idx.byNormRelevantY, "matched_by_relevant_y"], [idx.byNormRelevantG, "matched_by_relevant_g"]];
  for (const [map, status] of relOrder) {
    const hit = map.get(norm);
    if (hit && hit.length) return pickFromEntries(hit, status);
  }
  const tgt = idx.byNormTarget.get(norm);
  if (tgt && tgt.length) return pickFromEntries(tgt, "matched_by_target");
  if (idx.hints.length) {
    const tokens = new Set(tokenize(norm));
    // A hint matches ONLY when ALL of its tokens are present in the URL —
    // this avoids false positives like "drive-beyond-horizons" being
    // attributed to Google Drive because of a single shared token.
    const hits = idx.hints.filter((h) => h.tokens.length > 0 && h.tokens.every((t) => tokens.has(t)));
    if (hits.length) {
      const uniqueGroups = new Set(hits.map((h) => `${h.folder}::${h.group}`));
      // Prefer the most specific hint (longest token list) when several match.
      const best = hits.slice().sort((a, b) => b.tokens.length - a.tokens.length)[0];
      return {
        matched_url_id: null,
        matched_group_id: best.group,
        match_status: uniqueGroups.size > 1 ? "group_conflict" : "matched_by_name",
      };
    }
  }
  const slug = norm.split("/").filter(Boolean).pop() ?? "";
  if (slug) {
    const bySlug = idx.bySlug.get(slug);
    if (bySlug && bySlug.length === 1) {
      return { matched_url_id: bySlug[0].url, matched_group_id: bySlug[0].group, match_status: "matched_by_slug" };
    }
    if (bySlug && bySlug.length > 1) {
      return { matched_url_id: null, matched_group_id: null, match_status: "ambiguous_slug" };
    }
  }
  return { matched_url_id: null, matched_group_id: null, match_status: "unmatched" };
}
