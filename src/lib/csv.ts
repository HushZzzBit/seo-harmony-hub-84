import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { Query, UrlRow } from "./types";

export function parseCsv(text: string): Record<string, string>[] {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    delimiter: "",
    transformHeader: (h) => h.trim(),
  });
  return res.data.filter((r) => Object.keys(r).length > 0);
}

/** Parse XLSX file (ArrayBuffer) — first sheet, headers from row 1 */
export function parseXlsx(buf: ArrayBuffer): Record<string, string>[] {
  const wb = XLSX.read(buf, { type: "array" });
  const rows: Record<string, string>[] = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const arr = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: "",
      raw: false,
    });
    for (const r of arr) {
      const obj: Record<string, string> = {};
      for (const k of Object.keys(r)) obj[String(k).trim()] = String(r[k] ?? "");
      rows.push(obj);
    }
  }
  return rows.filter((r) => Object.keys(r).length > 0);
}

/** Auto-detect: parse CSV or XLSX from File */
export async function readTabular(file: File): Promise<Record<string, string>[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    const buf = await file.arrayBuffer();
    return parseXlsx(buf);
  }
  const text = await file.text();
  return parseCsv(text);
}

const H = (keys: string[], row: Record<string, string>): string | undefined => {
  for (const k of Object.keys(row)) {
    const lk = k.toLowerCase().trim();
    if (keys.some((n) => lk === n || lk.includes(n))) return row[k];
  }
  return undefined;
};

const num = (v?: string) => {
  if (v == null || v === "") return undefined;
  const n = Number(String(v).replace(/\s|,/g, (m) => (m === "," ? "." : "")));
  return Number.isFinite(n) ? n : undefined;
};

/** Topvisor: queries with folder/group/url/frequency/positions */
export function parseTopvisorQueries(text: string): Query[] {
  const rows = parseCsv(text);
  return rows.map((r, i) => {
    const phrase = H(["запрос", "phrase", "keyword", "query"], r) ?? "";
    const folder = H(["папк", "folder", "стрим"], r) ?? "Без папки";
    const group = H(["групп", "group"], r) ?? "Без группы";
    const url = H(["url", "адрес", "страниц"], r);
    const frequency =
      num(H(["частот", "frequency", "wordstat", "volume"], r)) ?? 0;
    const googlePosition = num(H(["google", "гугл"], r));
    const yandexPosition = num(H(["yandex", "яндекс"], r));
    return {
      id: `${folder}::${group}::${phrase}::${i}`,
      phrase: phrase.trim(),
      folder: folder.trim(),
      group: group.trim(),
      url: url?.trim(),
      frequency,
      googlePosition,
      yandexPosition,
      seasonality: new Array(12).fill(0),
    };
  }).filter((q) => q.phrase);
}

const MONTH_KEYS = [
  ["янв", "jan"],
  ["фев", "feb"],
  ["мар", "mar"],
  ["апр", "apr"],
  ["май", "may"],
  ["июн", "jun"],
  ["июл", "jul"],
  ["авг", "aug"],
  ["сен", "sep"],
  ["окт", "oct"],
  ["ноя", "nov"],
  ["дек", "dec"],
];

/** Seasonality CSV: phrase + 12 monthly columns */
export function parseSeasonality(text: string): Record<string, number[]> {
  const rows = parseCsv(text);
  const out: Record<string, number[]> = {};
  for (const r of rows) {
    const phrase = H(["запрос", "phrase", "keyword"], r);
    if (!phrase) continue;
    const arr = new Array(12).fill(0);
    for (let i = 0; i < 12; i++) {
      const keys = MONTH_KEYS[i];
      for (const k of Object.keys(r)) {
        const lk = k.toLowerCase();
        if (keys.some((m) => lk.includes(m))) {
          arr[i] = num(r[k]) ?? 0;
          break;
        }
      }
    }
    out[phrase.toLowerCase().trim()] = arr;
  }
  return out;
}

/** Netpeak: url, title, description, h1, text length */
export function parseNetpeak(text: string): UrlRow[] {
  const rows = parseCsv(text);
  return rows.map((r) => ({
    url: (H(["url", "адрес"], r) ?? "").trim(),
    title: H(["title", "тайтл"], r),
    description: H(["description", "описан"], r),
    h1: H(["h1"], r),
    textLength: num(H(["длин", "length", "text length", "words"], r)),
    hasText: (() => {
      const v = H(["has text", "есть текст", "наличие"], r);
      if (v == null) {
        const l = num(H(["длин", "length", "words"], r)) ?? 0;
        return l > 0;
      }
      return /1|true|да|yes/i.test(v);
    })(),
    text: H(["text", "текст"], r),
  })).filter((r) => r.url);
}

export function toCsv(rows: Record<string, unknown>[]): string {
  return Papa.unparse(rows);
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
