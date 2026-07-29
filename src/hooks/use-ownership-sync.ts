// Периодически пересчитывает реестр владения URL из Topvisor queries + DataLens
// и сохраняет в Zustand + БД (fire-and-forget).
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useStore } from "@/lib/store";
import { computeOwnership } from "@/lib/ownership";
import { getDataLensMetrics } from "@/lib/datalens.functions";
import { saveOwnership, loadOwnership } from "@/lib/ownership.functions";

export function useOwnershipSync() {
  const queries = useStore((s) => s.queries);
  const setOwnership = useStore((s) => s.setOwnership);
  const getFn = useServerFn(getDataLensMetrics);
  const saveFn = useServerFn(saveOwnership);
  const loadFn = useServerFn(loadOwnership);
  const bootRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Boot: подтянуть сохранённый реестр из БД, чтобы не ждать пересчёта.
  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    loadFn()
      .then((rows) => {
        if (!rows.length) return;
        const map: Record<string, { folder: string | null; group: string | null }> = {};
        for (const r of rows) map[r.normalized_url] = { folder: r.folder, group: r.group };
        setOwnership(map);
      })
      .catch(() => {});
  }, [loadFn, setOwnership]);

  // Пересчёт при изменении queries (debounced).
  useEffect(() => {
    if (!queries.length) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const { categories, startUrls } = await getFn({ data: { stream: null } });
        const own = computeOwnership(queries, categories, startUrls);
        const map: Record<string, { folder: string | null; group: string | null }> = {};
        for (const [k, v] of Object.entries(own)) map[k] = { folder: v.folder, group: v.group };
        setOwnership(map);
        // persist (fire-and-forget)
        const rows = Object.entries(own).map(([normalized_url, v]) => ({ normalized_url, ...v }));
        saveFn({ data: { rows } }).catch(() => {});
      } catch {
        /* silent — данных DataLens может не быть */
      }
    }, 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [queries, getFn, saveFn, setOwnership]);
}
