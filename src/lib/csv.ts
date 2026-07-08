import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { Query, UrlRow } from "./types";

/* ------------------------------------------------------------------ */
/* Low-level readers: everything returns a matrix (string[][])         */
/* ------------------------------------------------------------------ */

function decodeBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  // Try UTF-8 strict; if fails or produces replacement chars → windows-1251
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return s;
  } catch {
    return new TextDecoder("windows-1251").decode(bytes);
  }
}

export function parseCsvMatrix(text: string): string[][] {
  const res = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    delimiter: "", // auto-detect (handles `;` and `,`)
  });
  return (res.data as string[][]).map((r) => r.map((c) => (c == null ? "" : String(c))));
}

export function parseXlsxMatrix(buf: ArrayBuffer): string[][] {
  const wb = XLSX.read(buf, { type: "array" });
  const name = wb.SheetNames[0];
  const sheet = wb.Sheets[name];
  const arr = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
    blankrows: false,
  });
  return arr.map((r) => (r as unknown[]).map((c) => (c == null ? "" : String(c))));
}

/** Auto-detect: CSV/XLSX/XLS → matrix (string[][]) */
export async function readMatrix(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) return parseXlsxMatrix(buf);
  return parseCsvMatrix(decodeBytes(buf));
}

/** Convert matrix (with header row) → array of records */
export function matrixToRows(m: string[][], headerRow = 0): Record<string, string>[] {
  if (m.length <= headerRow) return [];
  const headers = m[headerRow].map((h) => String(h).trim());
  const out: Record<string, string>[] = [];
  for (let i = headerRow + 1; i < m.length; i++) {
    const row = m[i];
    if (!row || row.every((c) => c === "" || c == null)) continue;
    const obj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c] ?? "";
    out.push(obj);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const num = (v?: string | number): number | undefined => {
  if (v == null || v === "") return undefined;
  const s = String(v).replace(/\s/g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** Excel serial date → JS Date (works for cells stored as numbers) */
function excelSerialToDate(n: number): Date | null {
  if (!Number.isFinite(n) || n < 1 || n > 80000) return null;
  // Excel epoch = 1899-12-30 (accounts for 1900 leap-year bug)
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return isNaN(d.getTime()) ? null : d;
}

/** Parse header cell that may be a date: "01.01.2024", "2024-01-01", or excel serial */
function parseHeaderDate(v: string): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  // dd.mm.yyyy
  const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
  if (m) {
    const dd = +m[1], mm = +m[2], yyyy = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const d = new Date(yyyy, mm - 1, dd);
    return isNaN(d.getTime()) ? null : d;
  }
  // yyyy-mm-dd
  const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m2) return new Date(+m2[1], +m2[2] - 1, +m2[3]);
  // excel serial number as string
  const n = Number(s);
  if (Number.isFinite(n)) return excelSerialToDate(n);
  return null;
}

/* ------------------------------------------------------------------ */
/* TOPVISOR — multi-row header, columns:                               */
/*   Запросы | Имя группы | Целевая ссылка | (region blocks with       */
/*   engine spans "Google"/"Yandex" and per-date position columns)     */
/* ------------------------------------------------------------------ */

export function parseTopvisorQueries(matrix: string[][]): Query[] {
  if (!matrix.length) return [];

  // 1) Locate header row (the one containing "Запрос…")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(matrix.length, 10); i++) {
    if (matrix[i].some((c) => /^запрос/i.test(String(c).trim()))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return [];

  const header = matrix[headerIdx];
  const engineRow = headerIdx > 0 ? [...matrix[headerIdx - 1]] : [];
  // Forward-fill engine labels (they only appear on the first cell of the span)
  let cur = "";
  for (let c = 0; c < header.length; c++) {
    const v = String(engineRow[c] ?? "").trim();
    if (v) cur = v;
    engineRow[c] = cur;
  }

  const findCol = (test: (h: string) => boolean) =>
    header.findIndex((h) => test(String(h ?? "").toLowerCase().trim()));

  const cPhrase = findCol((h) => h.startsWith("запрос"));
  const cGroup = findCol((h) => h.includes("групп"));
  const cUrl = findCol((h) => h.includes("целев") || h === "url" || h.includes("ссылк"));
  const cTag = findCol((h) => h.includes("тег"));
  // Frequency columns — prefer "!"W"" (exact match), then any "частот"
  const freqCols: number[] = [];
  for (let c = 0; c < header.length; c++) {
    const h = String(header[c] ?? "").toLowerCase();
    if (h.includes("частот") || h.includes("frequency") || /\bws\b/.test(h) || /"!?w"?/.test(h)) {
      freqCols.push(c);
    }
  }
  // Prefer the strictest ("!W") if present
  const cFreqStrict = freqCols.find((c) => /"!w"/i.test(String(header[c] ?? "")));
  const cFreq = cFreqStrict ?? freqCols[0];

  // Position columns: headers that parse as a date (Excel serial or dd.mm.yyyy)
  type PosCol = { col: number; date: Date; engine: "google" | "yandex" | "other" };
  const posCols: PosCol[] = [];
  for (let c = 0; c < header.length; c++) {
    const d = parseHeaderDate(String(header[c]));
    if (!d) continue;
    const eng = String(engineRow[c] ?? "").toLowerCase();
    const engine: PosCol["engine"] = eng.includes("google")
      ? "google"
      : eng.includes("yandex") || eng.includes("яндекс")
      ? "yandex"
      : "other";
    posCols.push({ col: c, date: d, engine });
  }
  const latestPer = (engine: "google" | "yandex"): number | undefined => {
    const cols = posCols.filter((p) => p.engine === engine);
    if (!cols.length) return undefined;
    cols.sort((a, b) => b.date.getTime() - a.date.getTime());
    return cols[0].col;
  };
  const gCol = latestPer("google");
  const yCol = latestPer("yandex");

  const out: Query[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || !row.length) continue;
    const phrase = String(row[cPhrase] ?? "").trim();
    if (!phrase) continue;
    const group = String((cGroup >= 0 ? row[cGroup] : "") || "").trim() || "Без группы";
    const tag = cTag >= 0 ? String(row[cTag] ?? "").trim() : "";
    const folder = tag && tag !== "Тег по умолчанию" ? tag : group;
    const url = cUrl >= 0 ? String(row[cUrl] ?? "").trim() : "";
    out.push({
      id: `${folder}::${group}::${phrase}::${i}`,
      phrase,
      folder,
      group,
      url: url || undefined,
      frequency: 0,
      googlePosition: gCol != null ? num(String(row[gCol])) : undefined,
      yandexPosition: yCol != null ? num(String(row[yCol])) : undefined,
      seasonality: new Array(12).fill(0),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* SEASONALITY — first col = phrase, other cols = dates per month      */
/*   Aggregates across years → 12 monthly averages                     */
/* ------------------------------------------------------------------ */

export function parseSeasonality(matrix: string[][]): Record<string, number[]> {
  if (matrix.length < 2) return {};
  const header = matrix[0];
  // Map each column → month index (0..11) if it parses as a date
  const colMonth: (number | null)[] = header.map((h) => {
    const d = parseHeaderDate(String(h));
    return d ? d.getMonth() : null;
  });

  const out: Record<string, number[]> = {};
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row?.length) continue;
    const phrase = String(row[0] ?? "").trim();
    if (!phrase) continue;
    const sums = new Array(12).fill(0);
    const counts = new Array(12).fill(0);
    for (let c = 1; c < row.length; c++) {
      const m = colMonth[c];
      if (m == null) continue;
      const v = num(String(row[c]));
      if (v == null) continue;
      sums[m] += v;
      counts[m] += 1;
    }
    const arr = sums.map((s, i) => (counts[i] ? s / counts[i] : 0));
    out[phrase.toLowerCase()] = arr;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* NETPEAK SPIDER — header row 0                                       */
/* ------------------------------------------------------------------ */

const findKey = (row: Record<string, string>, tests: (string | RegExp)[]): string | undefined => {
  for (const k of Object.keys(row)) {
    const lk = k.toLowerCase().trim();
    for (const t of tests) {
      if (typeof t === "string" ? lk === t || lk.includes(t) : t.test(lk)) return row[k];
    }
  }
  return undefined;
};

export function parseNetpeak(matrix: string[][]): UrlRow[] {
  const rows = matrixToRows(matrix, 0);
  return rows
    .map<UrlRow>((r) => {
      const url = (findKey(r, ["url", "адрес"]) ?? "").trim();
      const words = num(findKey(r, ["количество слов", "words", "слов"]));
      const chars = num(findKey(r, ["количество символов", "символов", "characters"]));
      const textLen = words ?? chars;
      return {
        url,
        title: findKey(r, ["title", "тайтл"]),
        description: findKey(r, ["description", "описан"]),
        h1: findKey(r, ["содержимое h1", "h1"]),
        textLength: textLen,
        hasText: (textLen ?? 0) > 50,
      };
    })
    .filter((r) => r.url && /^https?:\/\//i.test(r.url));
}

/* ------------------------------------------------------------------ */
/* Export helpers (unchanged)                                          */
/* ------------------------------------------------------------------ */

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
