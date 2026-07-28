import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Асинхронное/дебаунсенное localStorage:
 * запись сериализованного стора выполняется не чаще раза в 400мс
 * и через requestIdleCallback — чтобы импорт больших XLSX не блокировал UI.
 */
function debouncedLocalStorage(): Storage {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const idle: (cb: () => void) => void =
    typeof window !== "undefined" && "requestIdleCallback" in window
      ? (cb) => (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(cb)
      : (cb) => setTimeout(cb, 0);

  const flush = () => {
    timer = null;
    idle(() => {
      for (const [k, v] of pending) {
        try {
          localStorage.setItem(k, v);
        } catch {
          /* quota / private mode — тихо игнорируем */
        }
      }
      pending.clear();
    });
  };

  return {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => {
      pending.set(k, v);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 400);
    },
    removeItem: (k) => {
      pending.delete(k);
      localStorage.removeItem(k);
    },
    clear: () => {
      pending.clear();
      localStorage.clear();
    },
    key: (i) => localStorage.key(i),
    get length() {
      return localStorage.length;
    },
  };
}

import type {
  FolderState,
  GroupState,
  MetaEdit,
  MetaHistoryEntry,
  MetaSource,
  PromptTemplate,
  QualityThresholds,
  Query,
  TextQualityCheck,
  TextRow,
  UrlRow,
} from "./types";
import { DEFAULT_THRESHOLDS, applyThresholds } from "./quality";

interface State {
  queries: Query[];
  urls: Record<string, UrlRow>;
  metaEdits: Record<string, MetaEdit>;
  metaHistory: MetaHistoryEntry[];
  texts: Record<string, TextRow>;
  folderState: Record<string, FolderState>;
  groupState: Record<string, GroupState>;
  prompts: Record<string, PromptTemplate>;
  qualityChecks: Record<string, TextQualityCheck>;
  /** Per-folder thresholds. Ключ '__default' — глобальные значения (используются как фолбэк). */
  qualityThresholds: Record<string, QualityThresholds>;
  /** Per-folder writer requirements. Ключ '__default' — глобальный текст. */
  writerRequirements: Record<string, string>;

  upsertQueries: (rows: Query[]) => void;
  upsertUrls: (rows: UrlRow[]) => void;
  applySeasonality: (map: Record<string, number[]>) => void;
  setMetaEdit: (url: string, patch: Partial<MetaEdit>) => void;
  setMetaEditsBulk: (urls: string[], patch: Partial<MetaEdit>) => void;
  setText: (url: string, patch: Partial<TextRow>) => void;
  setTextsBulk: (urls: string[], patch: Partial<TextRow>) => void;
  setFolderState: (folder: string, patch: Partial<FolderState>) => void;
  setGroupState: (folder: string, group: string, patch: Partial<GroupState>) => void;
  setPrompt: (folder: string, patch: Partial<PromptTemplate>) => void;
  resetPrompt: (folder: string) => void;
  setQualityCheck: (url: string, check: TextQualityCheck) => void;
  setQualityThresholds: (folder: string, patch: Partial<QualityThresholds>) => void;
  resetQualityThresholds: (folder: string) => void;
  setWriterRequirements: (folder: string, v: string) => void;
  clearAll: () => void;
}

export const GLOBAL_FOLDER_KEY = "__default";

function cloneDefaults(): QualityThresholds {
  return JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
}

/** Resolves per-folder thresholds with a global fallback. */
export function resolveThresholds(
  map: Record<string, QualityThresholds> | undefined,
  folder: string | undefined | null,
): QualityThresholds {
  const f = (folder ?? "").trim();
  if (f && map?.[f]) return map[f];
  if (map?.[GLOBAL_FOLDER_KEY]) return map[GLOBAL_FOLDER_KEY];
  return cloneDefaults();
}

/** Resolves per-folder writer requirements. */
export function resolveWriterRequirements(
  map: Record<string, string> | undefined,
  folder: string | undefined | null,
): string {
  const f = (folder ?? "").trim();
  if (f && map?.[f]) return map[f];
  return map?.[GLOBAL_FOLDER_KEY] ?? "";
}


export const useStore = create<State>()(
  persist(
    (set, get) => ({
      queries: [],
      urls: {},
      metaEdits: {},
      metaHistory: [],
      texts: {},
      folderState: {},
      groupState: {},
      prompts: {},
      qualityChecks: {},
      qualityThresholds: JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)),
      writerRequirements: "",



      upsertQueries: (rows) => {
        const map = new Map(get().queries.map((q) => [q.id, q]));
        for (const r of rows) map.set(r.id, { ...map.get(r.id), ...r });
        set({ queries: Array.from(map.values()) });
      },
      upsertUrls: (rows) => {
        const urls = { ...get().urls };
        for (const r of rows) {
          if (!r.url) continue;
          urls[r.url] = { ...urls[r.url], ...r };
        }
        set({ urls });
      },
      applySeasonality: (map) => {
        const queries = get().queries.map((q) => {
          const s = map[q.phrase.toLowerCase().trim()];
          return s ? { ...q, seasonality: s } : q;
        });
        set({ queries });
      },
      setMetaEdit: (url, patch) => {
        const prev = get().metaEdits[url] ?? { url };
        const history = [...get().metaHistory];
        const now = Date.now();
        let source: MetaSource | undefined = patch.source;
        let contentChanged = false;
        (["title", "description", "h1"] as const).forEach((f) => {
          if (patch[f] !== undefined && patch[f] !== prev[f]) {
            contentChanged = true;
            history.push({
              url,
              field: f,
              oldValue: prev[f] ?? get().urls[url]?.[f] ?? "",
              newValue: patch[f] as string,
              at: now,
            });
          }
        });
        // Derive source when content changes and caller didn't specify it.
        if (contentChanged && source === undefined) {
          source = prev.source === "ai" || prev.source === "ai+manual" ? "ai+manual" : "manual";
        }
        const nextEdit: MetaEdit = { ...prev, ...patch, updatedAt: now };
        if (source !== undefined) nextEdit.source = source;
        set({
          metaEdits: { ...get().metaEdits, [url]: nextEdit },
          metaHistory: history.slice(-2000),
        });
      },
      setText: (url, patch) => {
        const prev = get().texts[url] ?? { url, status: "not_assigned" as const };
        set({
          texts: { ...get().texts, [url]: { ...prev, ...patch, updatedAt: Date.now() } },
        });
      },
      setMetaEditsBulk: (urls, patch) => {
        if (!urls.length) return;
        const now = Date.now();
        const cur = get().metaEdits;
        const next = { ...cur };
        for (const u of urls) {
          if (!u) continue;
          const prev = cur[u] ?? { url: u };
          next[u] = { ...prev, ...patch, updatedAt: now };
        }
        set({ metaEdits: next });
      },
      setTextsBulk: (urls, patch) => {
        if (!urls.length) return;
        const now = Date.now();
        const cur = get().texts;
        const next = { ...cur };
        for (const u of urls) {
          if (!u) continue;
          const prev = cur[u] ?? { url: u, status: "not_assigned" as const };
          next[u] = { ...prev, ...patch, updatedAt: now };
        }
        set({ texts: next });
      },
      setFolderState: (folder, patch) => {
        const prev = get().folderState[folder] ?? { folder, status: "not_started" as const };
        set({ folderState: { ...get().folderState, [folder]: { ...prev, ...patch } } });
      },
      setGroupState: (folder, group, patch) => {
        const key = `${folder}::${group}`;
        const prev = get().groupState[key] ?? { status: "not_started" as const };
        set({ groupState: { ...get().groupState, [key]: { ...prev, ...patch } } });
      },
      setPrompt: (folder, patch) => {
        const prev = get().prompts[folder] ?? {};
        set({
          prompts: {
            ...get().prompts,
            [folder]: { ...prev, ...patch, updatedAt: Date.now() },
          },
        });
      },
      resetPrompt: (folder) => {
        const next = { ...get().prompts };
        delete next[folder];
        set({ prompts: next });
      },
      setQualityCheck: (url, check) =>
        set({ qualityChecks: { ...get().qualityChecks, [url]: check } }),
      setQualityThresholds: (patch) => {
        const cur = get().qualityThresholds;
        const next: QualityThresholds = {
          unique: { ...cur.unique, ...(patch.unique ?? {}) },
          water: { ...cur.water, ...(patch.water ?? {}) },
          spam: { ...cur.spam, ...(patch.spam ?? {}) },
          ai: { ...cur.ai, ...(patch.ai ?? {}) },
          turgenev: { ...cur.turgenev, ...(patch.turgenev ?? {}) },
        };
        applyThresholds(next);
        set({ qualityThresholds: next });
      },
      resetQualityThresholds: () => {
        const next = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS)) as QualityThresholds;
        applyThresholds(next);
        set({ qualityThresholds: next });
      },
      setWriterRequirements: (v) => set({ writerRequirements: v }),
      clearAll: () =>
        set({
          queries: [],
          urls: {},
          metaEdits: {},
          metaHistory: [],
          texts: {},
          folderState: {},
          groupState: {},
          prompts: {},
          qualityChecks: {},
        }),

    }),
    {
      name: "seo-analytics-v1",
      storage: createJSONStorage(() =>
        typeof window === "undefined" ? (undefined as unknown as Storage) : debouncedLocalStorage(),
      ),
      onRehydrateStorage: () => (state) => {
        if (state?.qualityThresholds) applyThresholds(state.qualityThresholds);
      },
    },
  ),
);
