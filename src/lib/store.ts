import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  FolderState,
  MetaEdit,
  MetaHistoryEntry,
  Query,
  TextRow,
  UrlRow,
} from "./types";

interface State {
  queries: Query[];
  urls: Record<string, UrlRow>;
  metaEdits: Record<string, MetaEdit>;
  metaHistory: MetaHistoryEntry[];
  texts: Record<string, TextRow>;
  folderState: Record<string, FolderState>;

  upsertQueries: (rows: Query[]) => void;
  upsertUrls: (rows: UrlRow[]) => void;
  applySeasonality: (map: Record<string, number[]>) => void; // key: phrase
  setMetaEdit: (url: string, patch: Partial<MetaEdit>) => void;
  setText: (url: string, patch: Partial<TextRow>) => void;
  setFolderState: (folder: string, patch: Partial<FolderState>) => void;
  clearAll: () => void;
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
        (["title", "description", "h1"] as const).forEach((f) => {
          if (patch[f] !== undefined && patch[f] !== prev[f]) {
            history.push({
              url,
              field: f,
              oldValue: prev[f] ?? get().urls[url]?.[f] ?? "",
              newValue: patch[f] as string,
              at: now,
            });
          }
        });
        set({
          metaEdits: { ...get().metaEdits, [url]: { ...prev, ...patch, updatedAt: now } },
          metaHistory: history.slice(-2000),
        });
      },
      setText: (url, patch) => {
        const prev = get().texts[url] ?? { url, status: "not_assigned" as const };
        set({
          texts: { ...get().texts, [url]: { ...prev, ...patch, updatedAt: Date.now() } },
        });
      },
      setFolderState: (folder, patch) => {
        const prev = get().folderState[folder] ?? { folder, status: "not_started" as const };
        set({ folderState: { ...get().folderState, [folder]: { ...prev, ...patch } } });
      },
      clearAll: () =>
        set({
          queries: [],
          urls: {},
          metaEdits: {},
          metaHistory: [],
          texts: {},
          folderState: {},
        }),
    }),
    { name: "seo-analytics-v1" },
  ),
);
