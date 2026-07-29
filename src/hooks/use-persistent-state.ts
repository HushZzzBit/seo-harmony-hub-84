import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useState + localStorage persistence keyed by `key`.
 * Restores value across route navigation and page reloads.
 * SSR-safe: reads storage only on the client.
 */
export function usePersistentState<T>(key: string, initial: T) {
  const storageKey = `ui:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* ignore quota */
    }
  }, [storageKey, value]);

  const reset = useCallback(() => setValue(initial), [initial]);
  return [value, setValue, reset] as const;
}
