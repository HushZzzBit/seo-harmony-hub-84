import { useCallback, useSyncExternalStore } from "react";

/**
 * Глобальный (сквозной) скоуп фильтров сервиса: папка, группа и сортировка.
 * Значение общее для всех разделов (Дашборд, Мета-теги, SEO Тексты, LSI)
 * и переживает навигацию и перезагрузку страницы.
 */
export interface GlobalScope {
  folder: string; // "all" | конкретная папка
  group: string; // "all" | конкретная группа
  sortKey: string;
  sortDir: "asc" | "desc";
}

const STORAGE_KEY = "ui:global.scope";
const DEFAULT: GlobalScope = { folder: "all", group: "all", sortKey: "priority", sortDir: "asc" };

let state: GlobalScope = DEFAULT;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) state = { ...DEFAULT, ...(JSON.parse(raw) as Partial<GlobalScope>) };
  } catch {
    /* ignore */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

export function setGlobalScope(patch: Partial<GlobalScope>) {
  hydrate();
  const next = { ...state, ...patch };
  if (
    next.folder === state.folder &&
    next.group === state.group &&
    next.sortKey === state.sortKey &&
    next.sortDir === state.sortDir
  ) {
    return;
  }
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
  emit();
}

function subscribe(cb: () => void) {
  hydrate();
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || !e.newValue) return;
    try {
      state = { ...DEFAULT, ...(JSON.parse(e.newValue) as Partial<GlobalScope>) };
      emit();
    } catch {
      /* ignore */
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): GlobalScope {
  hydrate();
  return state;
}

function getServerSnapshot(): GlobalScope {
  return DEFAULT;
}

export function useGlobalScope() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Папка: смена папки сбрасывает выбранную группу. */
export function useGlobalFolder(): [string, (f: string) => void] {
  const { folder } = useGlobalScope();
  const set = useCallback((f: string) => {
    setGlobalScope({ folder: f, group: "all" });
  }, []);
  return [folder, set];
}

export function useGlobalGroup(): [string, (g: string) => void] {
  const { group } = useGlobalScope();
  const set = useCallback((g: string) => setGlobalScope({ group: g }), []);
  return [group, set];
}

/**
 * Сортировка: направление общее, ключ общий, но если раздел не поддерживает
 * сохранённый ключ — используется его дефолт.
 */
export function useGlobalSort<K extends string>(
  allowed: readonly K[],
  fallback: K,
): [K, "asc" | "desc", (key: K, dir?: "asc" | "desc") => void] {
  const { sortKey, sortDir } = useGlobalScope();
  const key = (allowed as readonly string[]).includes(sortKey) ? (sortKey as K) : fallback;
  const set = useCallback(
    (k: K, dir?: "asc" | "desc") => setGlobalScope({ sortKey: k, ...(dir ? { sortDir: dir } : {}) }),
    [],
  );
  return [key, sortDir, set];
}
