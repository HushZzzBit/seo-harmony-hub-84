// Server-only helpers для сохранения url_ownership.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { OwnershipRow } from "./ownership";

export interface OwnershipUpsertRow extends OwnershipRow {
  normalized_url: string;
}

/** Полная замена реестра. Транзакция: delete-all + insert батчами. */
export async function replaceOwnership(rows: OwnershipUpsertRow[]) {
  // Очищаем старые записи (условие всегда истинно).
  const { error: delErr } = await supabaseAdmin
    .from("url_ownership")
    .delete()
    .not("normalized_url", "is", null);
  if (delErr) throw new Error(delErr.message);

  if (!rows.length) return { inserted: 0 };

  const chunk = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk).map((r) => ({
      normalized_url: r.normalized_url,
      folder: r.folder,
      group: r.group,
      source: r.source,
      confidence: r.confidence,
      hit_count: r.hits,
    }));
    const { error } = await supabaseAdmin.from("url_ownership").insert(slice);
    if (error) throw new Error(error.message);
    inserted += slice.length;
  }
  return { inserted };
}

export async function readOwnership(): Promise<OwnershipUpsertRow[]> {
  const { data, error } = await supabaseAdmin
    .from("url_ownership")
    .select("normalized_url, folder, \"group\", source, confidence, hit_count")
    .limit(50000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    normalized_url: r.normalized_url as string,
    folder: (r.folder as string | null) ?? null,
    group: (r.group as string | null) ?? null,
    source: r.source as string,
    confidence: r.confidence as number,
    hits: (r.hit_count as number) ?? 0,
  }));
}
