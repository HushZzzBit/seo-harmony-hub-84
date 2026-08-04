// Client-side DataLens parsing helpers (no server imports here).
import * as XLSX from "xlsx";
import Papa from "papaparse";

export type DataLensType = "categories" | "start_url";

export interface CategoryRow {
  category_id: string | null;
  category_name: string | null;
  category_url: string | null;
  normalized_url: string | null;
  level: number | null;
  active_goods: number | null;
  sellers: number | null;
  gmv: number | null;
  base_id: string | null;
  base_category: string | null;
  goods_in_base: number | null;
  sellers_in_base: number | null;
  first_child: string | null;
  second_child: string | null;
  third_child: string | null;
}

export interface StartUrlRow {
  page_name: string | null;
  page_type: string | null;
  url: string | null;
  normalized_url: string | null;
  visits: number | null;
  users: number | null;
  new_users_percent: number | null;
  bounce_rate: number | null;
  page_depth: number | null;
  average_visit_sec: number | null;
  visit_to_click_buy: number | null;
  visit_to_order: number | null;
  orders: number | null;
  gmv: number | null;
  aov: number | null;
  arpu: number | null;
  arppu: number | null;
  yandex_traffic_percent: number | null;
  google_traffic_percent: number | null;
}

/** Extract url string from a raw cell that may be plain string OR a JSON-ish
 *  object like {'type': 'url', 'url': 'https://...'} (single quotes are common). */
export function extractUrl(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === "object") {
    const v = (raw as Record<string, unknown>).url;
    return typeof v === "string" ? v : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("{")) {
    // try JSON.parse after replacing single quotes and Python-ish tokens
    const jsonish = s
      .replace(/'/g, '"')
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false");
    try {
      const obj = JSON.parse(jsonish) as { url?: unknown };
      if (obj && typeof obj.url === "string") return obj.url;
    } catch {
      const m = s.match(/['"]url['"]\s*:\s*['"]([^'"]+)['"]/);
      if (m) return m[1];
    }
    return null;
  }
  return s;
}

/** Normalize URL: strip protocol/www/query/hash/trailing slash, lowercase host. */
export function normalizeUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const raw = String(u).trim();
  if (!raw) return null;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/+/, "")}`;
    const url = new URL(withProto);
    const host = url.host.replace(/^www\./i, "").toLowerCase();
    let path = url.pathname.replace(/\/+$/, "");
    if (!path) path = "";
    return `${host}${path}`;
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split(/[?#]/)[0]
      .replace(/\/+$/, "")
      .toLowerCase();
  }
}

const numFrom = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const s = String(v).replace(/\s+/g, "").replace(",", ".").replace(/%$/, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const strFrom = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/** Parse xlsx/csv into record rows (headers preserved, cells as raw values). */
export async function readRecords(file: File): Promise<Record<string, unknown>[]> {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith(".csv")) {
    const bytes = new Uint8Array(buf);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("windows-1251").decode(bytes);
    }
    const res = Papa.parse<Record<string, unknown>>(text, {
      header: true,
      skipEmptyLines: true,
      delimiter: "",
    });
    return res.data as Record<string, unknown>[];
  }
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: true,
    blankrows: false,
  });
}

/** Case-insensitive header lookup; returns first matching key present in row. */
function pick(row: Record<string, unknown>, candidates: string[]): unknown {
  const keys = Object.keys(row);
  const lowerMap = new Map(keys.map((k) => [k.toLowerCase().replace(/\s+/g, " ").trim(), k]));
  for (const c of candidates) {
    const key = lowerMap.get(c.toLowerCase().replace(/\s+/g, " ").trim());
    if (key !== undefined) return row[key];
  }
  return undefined;
}

export function parseCategoryRows(rows: Record<string, unknown>[]): CategoryRow[] {
  return rows.map((r) => {
    const urlRaw = pick(r, ["Category URL", "URL", "category_url"]);
    const url = extractUrl(urlRaw);
    return {
      category_id: strFrom(pick(r, ["Category ID", "category_id"])),
      category_name: strFrom(pick(r, ["Category", "Category Name", "category_name"])),
      category_url: url,
      normalized_url: normalizeUrl(url),
      level: numFrom(pick(r, ["Level", "level"])),
      active_goods: numFrom(pick(r, ["Active Goods", "active_goods"])),
      sellers: numFrom(pick(r, ["Sellers", "sellers"])),
      gmv: numFrom(pick(r, ["GMV", "gmv"])),
      base_id: strFrom(pick(r, ["Base ID", "base_id"])),
      base_category: strFrom(pick(r, ["Base category", "Base Category", "base_category"])),
      goods_in_base: numFrom(pick(r, ["Goods in Base", "goods_in_base"])),
      sellers_in_base: numFrom(pick(r, ["Sellers in Base", "sellers_in_base"])),
      first_child: strFrom(pick(r, ["First Child", "first_child"])),
      second_child: strFrom(pick(r, ["Second Child", "second_child"])),
      third_child: strFrom(pick(r, ["Third Child", "third_child"])),
    };
  });
}

export function parseStartUrlRows(rows: Record<string, unknown>[]): StartUrlRow[] {
  return rows.map((r) => {
    const urlRaw = pick(r, ["URL", "Url", "url"]);
    const url = extractUrl(urlRaw);
    return {
      page_name: strFrom(pick(r, ["Page Name", "page_name"])),
      page_type: strFrom(pick(r, ["Type", "page_type"])),
      url,
      normalized_url: normalizeUrl(url),
      visits: numFrom(pick(r, ["Visits", "visits"])),
      users: numFrom(pick(r, ["Users", "users"])),
      new_users_percent: numFrom(pick(r, ["%New Users", "New Users %", "new_users_percent"])),
      bounce_rate: numFrom(pick(r, ["Bounce rate", "Bounce Rate", "bounce_rate"])),
      page_depth: numFrom(pick(r, ["Page depth", "Page Depth", "page_depth"])),
      average_visit_sec: numFrom(pick(r, ["Average Visit (sec)", "Average Visit", "average_visit_sec"])),
      visit_to_click_buy: numFrom(pick(r, ["Visit->Click Buy", "visit_to_click_buy"])),
      visit_to_order: numFrom(pick(r, ["Visit->Order", "visit_to_order"])),
      orders: numFrom(pick(r, ["Orders", "orders"])),
      gmv: numFrom(pick(r, ["GMV", "gmv"])),
      aov: numFrom(pick(r, ["AOV", "aov"])),
      arpu: numFrom(pick(r, ["ARPU", "arpu"])),
      arppu: numFrom(pick(r, ["ARPPU", "arppu"])),
      yandex_traffic_percent: numFrom(pick(r, ["%Yandex", "Yandex %", "yandex_traffic_percent"])),
      google_traffic_percent: numFrom(pick(r, ["%Google", "Google %", "google_traffic_percent"])),
    };
  });
}

/**
 * Карточки товара (URL, содержащие сегмент /product/) не прорабатываются:
 * они исключаются из мета-тегов, SEO-текстов, LSI, инвентаря и экспорта.
 */
export function isProductUrl(u: string | null | undefined): boolean {
  if (!u) return false;
  return /(^|[/])product([/]|$)/i.test(String(u).split(/[?#]/)[0]);
}
