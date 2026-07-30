// URL из DataLens, которых нет в выгрузке Topvisor.
// Нужны, чтобы вкладки проработки (Meta Tags, SEO Texts) показывали полный
// состав группы с пометкой «Нет в Topvisor».
import { useMemo } from "react";
import { useStore } from "@/lib/store";
import {
  useDataLens,
  useFolderGroups,
  useUrlOwnershipMap,
  filterByFolder,
} from "@/components/DashboardDataLensTabs";
import { normalizeUrl } from "@/lib/datalens";

export interface ExtraUrlRow {
  url: string;
  folder: string;
  group: string;
}

/**
 * @param folder значение фильтра папки ("all" — без ограничения)
 * @param group  значение фильтра группы/категории ("all" — без ограничения)
 */
export function useDataLensExtraUrls(folder: string, group: string): ExtraUrlRow[] {
  const queries = useStore((s) => s.queries);
  const stream = folder === "all" ? null : folder;
  const activeGroup = group === "all" ? null : group;
  const folderGroups = useFolderGroups(stream);
  const requestGroups = useMemo(
    () => (activeGroup ? [activeGroup] : folderGroups ? Array.from(folderGroups) : null),
    [activeGroup, folderGroups],
  );
  const { categories, startUrls } = useDataLens(null, requestGroups);
  const ownership = useUrlOwnershipMap();

  const topvisorUrls = useMemo(() => {
    const s = new Set<string>();
    for (const q of queries) {
      for (const u of [q.url, q.targetUrl, q.relevantGoogle, q.relevantYandex]) {
        const n = normalizeUrl(u ?? null);
        if (n) s.add(n);
      }
    }
    return s;
  }, [queries]);

  const groupFolder = useMemo(() => {
    const m = new Map<string, string>();
    for (const q of queries) if (q.group && !m.has(q.group)) m.set(q.group, q.folder);
    return m;
  }, [queries]);

  return useMemo(() => {
    const cats = filterByFolder(categories, folderGroups, activeGroup, ownership);
    const sus = filterByFolder(startUrls, folderGroups, activeGroup, ownership);
    const out = new Map<string, ExtraUrlRow>();
    const push = (norm: string | null, original: string | null, g: string | null) => {
      if (!norm || topvisorUrls.has(norm) || out.has(norm)) return;
      const own = ownership.get(norm);
      const grp = own?.group ?? g ?? "";
      if (!grp) return;
      if (activeGroup && grp !== activeGroup) return;
      if (!activeGroup && folderGroups && !folderGroups.has(grp)) return;
      out.set(norm, {
        url: original ?? norm,
        folder: own?.folder ?? groupFolder.get(grp) ?? (stream ?? ""),
        group: grp,
      });
    };
    for (const c of cats) push(c.normalized_url, c.category_url ?? null, c.matched_group_id);
    for (const s of sus) push(s.normalized_url, s.url ?? null, s.matched_group_id);
    return Array.from(out.values());
  }, [categories, startUrls, folderGroups, activeGroup, ownership, topvisorUrls, groupFolder, stream]);
}
