// Универсальная сортировка таблиц по клику на заголовок столбца.
import { useCallback, useMemo, useState } from "react";

export type SortDir = "asc" | "desc";
export type SortValue = string | number | null | undefined | boolean;

export interface TableSort<K extends string> {
  key: K;
  dir: SortDir;
  toggle: (key: K) => void;
  sort: <T>(rows: T[], get: (row: T, key: K) => SortValue) => T[];
}

export function useTableSort<K extends string>(defaultKey: K, defaultDir: SortDir = "desc"): TableSort<K> {
  const [key, setKey] = useState<K>(defaultKey);
  const [dir, setDir] = useState<SortDir>(defaultDir);

  const toggle = useCallback(
    (k: K) => {
      if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
      else {
        setKey(k);
        setDir("desc");
      }
    },
    [key],
  );

  const sort = useCallback(
    <T,>(rows: T[], get: (row: T, k: K) => SortValue): T[] => {
      const mul = dir === "asc" ? 1 : -1;
      return [...rows].sort((a, b) => {
        const av = get(a, key);
        const bv = get(b, key);
        const aEmpty = av == null || av === "" || av === "—";
        const bEmpty = bv == null || bv === "" || bv === "—";
        if (aEmpty && bEmpty) return 0;
        if (aEmpty) return 1; // пустые всегда в конце
        if (bEmpty) return -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * mul;
        if (typeof av === "boolean" && typeof bv === "boolean") return (Number(av) - Number(bv)) * mul;
        return String(av).localeCompare(String(bv), "ru") * mul;
      });
    },
    [key, dir],
  );

  return useMemo(() => ({ key, dir, toggle, sort }), [key, dir, toggle, sort]);
}

export function SortTh<K extends string>({
  sortKey,
  sort,
  align = "left",
  className = "",
  children,
}: {
  sortKey: K;
  sort: TableSort<K>;
  align?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={`py-1.5 px-2 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <button
        type="button"
        onClick={() => sort.toggle(sortKey)}
        className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground transition-colors ${
          active ? "text-foreground font-medium" : ""
        }`}
      >
        {children}
        <span className="text-[9px] opacity-70">{active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}
