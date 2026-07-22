import { createServerFn } from "@tanstack/react-start";

export type ProviderStatus = "success" | "failed" | "skipped";

export type ProviderResult = {
  provider: "text_ru" | "zerogpt" | "turgenev";
  status: ProviderStatus;
  requestedAt: number;
  completedAt: number;
  error?: string;
  reportUrl?: string;
  // normalized fields (optional per provider)
  waterPercent?: number;
  spamPercent?: number;
  uniquePercent?: number;
  aiPercent?: number;
  turgenevScore?: number;
  turgenevRiskLevel?: "ok" | "medium" | "high" | "critical";
  /** Raw provider response serialized as JSON string for debugging. */
  rawJson?: string;
};

export type QualityCheckResult = {
  textHash: string;
  requestedAt: number;
  completedAt: number;
  providers: ProviderResult[];
};

function stripHtml(s: string): string {
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function safeStringify(v: unknown): string {
  try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v); }
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 25000): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await res.text();
    let body: unknown = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { ok: res.ok, status: res.status, body, text };
  } finally {
    clearTimeout(t);
  }
}

// --------- Text.ru ---------
async function checkTextRu(plain: string): Promise<ProviderResult> {
  const started = Date.now();
  const key = process.env.TEXT_RU_USERKEY;
  const base: Omit<ProviderResult, "status"> = {
    provider: "text_ru",
    requestedAt: started,
    completedAt: started,
  };
  if (!key) return { ...base, status: "skipped", completedAt: Date.now(), error: "TEXT_RU_USERKEY not configured" };
  if (plain.length < 100) return { ...base, status: "skipped", completedAt: Date.now(), error: "Текст слишком короткий (< 100 симв.)" };

  try {
    // 1) submit — jsonvisible=detail нужен, иначе text.ru вернёт только уникальность без SEO-метрик
    const submitForm = new URLSearchParams();
    submitForm.set("text", plain);
    submitForm.set("userkey", key);
    submitForm.set("jsonvisible", "detail");
    type SubmitBody = { text_uid?: string; error_code?: number; error_desc?: string };
    let submit: Awaited<ReturnType<typeof fetchJson>> | null = null;
    let submitBody: SubmitBody | null = null;
    const submitDelays = [0, 5000, 10000, 20000];
    for (const wait of submitDelays) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        submit = await fetchJson("https://api.text.ru/post", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: submitForm.toString(),
        }, 40000);
      } catch (e) {
        submit = { ok: false, status: 0, body: null, text: (e as Error).message };
      }
      submitBody = (submit.body ?? null) as SubmitBody | null;
      if (submitBody?.text_uid) break;
      // ретраим только на сетевых/5xx ошибках или пустом ответе
      if (submit.status && submit.status < 500 && submit.status !== 0) break;
    }
    const uid = submitBody?.text_uid;
    if (!uid || !submit) {
      const httpNote = submit && submit.status >= 500 ? ` (text.ru временно недоступен, HTTP ${submit.status})` : "";
      return { ...base, status: "failed", completedAt: Date.now(), error: (submitBody?.error_desc ?? `submit ${submit?.status ?? "error"}`) + httpNote, rawJson: safeStringify(submit?.body) };
    }

    // 2) poll status
    const pollBody = new URLSearchParams();
    pollBody.set("uid", uid);
    pollBody.set("userkey", key);
    pollBody.set("jsonvisible", "detail");
    // up to ~3 минут polling с бэкоффом
    const delays = [6000, 6000, 8000, 8000, 10000, 10000, 15000, 15000, 20000, 20000, 25000, 25000];
    for (const wait of delays) {
      await new Promise((r) => setTimeout(r, wait));
      const poll = await fetchJson("https://api.text.ru/post", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: pollBody.toString(),
      });
      const p = poll.body as {
        text_unique?: string;
        result_json?: string;
        seo_check?: string | Record<string, unknown>;
        error_code?: number;
        error_desc?: string;
      } | null;
      // Not ready yet — text.ru обычно возвращает error_code=181/183
      if (p?.error_code && !p.result_json && !p.seo_check && !p.text_unique) continue;
      const seoRaw = p?.seo_check ?? (p?.result_json ? tryPickSeo(p.result_json) : undefined);
      const seo = typeof seoRaw === "string" ? safeJson(seoRaw) : (seoRaw as Record<string, unknown> | undefined);
      const water = num((seo as { water_percent?: unknown })?.water_percent);
      const spam = num((seo as { spam_percent?: unknown })?.spam_percent);
      const uniq = num(p?.text_unique);
      if (water !== undefined || spam !== undefined || uniq !== undefined) {
        return {
          ...base,
          status: "success",
          completedAt: Date.now(),
          waterPercent: water,
          spamPercent: spam,
          uniquePercent: uniq,
          reportUrl: `https://text.ru/antiplagiat/${uid}`,
          rawJson: safeStringify(p),
        };
      }
    }
    return { ...base, status: "failed", completedAt: Date.now(), error: "Timeout ожидания text.ru — проверка ещё идёт, повторите позже" };
  } catch (e) {
    return { ...base, status: "failed", completedAt: Date.now(), error: (e as Error).message };
  }
}

function tryPickSeo(resultJson: string): unknown {
  try {
    const parsed = JSON.parse(resultJson) as { seo_check?: unknown };
    return parsed.seo_check;
  } catch {
    return undefined;
  }
}
function safeJson(s: string): Record<string, unknown> | undefined {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return undefined; }
}
function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// --------- ZeroGPT ---------
async function checkZeroGpt(plain: string): Promise<ProviderResult> {
  const started = Date.now();
  const key = process.env.ZEROGPT_API_KEY;
  const base: Omit<ProviderResult, "status"> = { provider: "zerogpt", requestedAt: started, completedAt: started };
  if (!key) return { ...base, status: "skipped", completedAt: Date.now(), error: "ZEROGPT_API_KEY not configured" };
  if (plain.length < 50) return { ...base, status: "skipped", completedAt: Date.now(), error: "Текст слишком короткий (< 50 симв.)" };
  try {
    const res = await fetchJson("https://api.zerogpt.com/api/detect/detectText", {
      method: "POST",
      headers: { "Content-Type": "application/json", ApiKey: key },
      body: JSON.stringify({ input_text: plain }),
    });
    const body = res.body as {
      data?: { fakePercentage?: number; isHuman?: number; textWords?: number };
      success?: boolean;
      message?: string;
    } | null;
    const pct = num(body?.data?.fakePercentage);
    if (!res.ok || pct === undefined) {
      return { ...base, status: "failed", completedAt: Date.now(), error: body?.message ?? `HTTP ${res.status}`, rawJson: safeStringify(res.body) };
    }
    return { ...base, status: "success", completedAt: Date.now(), aiPercent: pct, rawJson: safeStringify(res.body) };
  } catch (e) {
    return { ...base, status: "failed", completedAt: Date.now(), error: (e as Error).message };
  }
}

// --------- Turgenev (Ашманов) ---------
async function checkTurgenev(plain: string): Promise<ProviderResult> {
  const started = Date.now();
  const key = process.env.TURGENEV_API_KEY;
  const base: Omit<ProviderResult, "status"> = { provider: "turgenev", requestedAt: started, completedAt: started };
  if (!key) return { ...base, status: "skipped", completedAt: Date.now(), error: "TURGENEV_API_KEY not configured" };
  if (plain.length < 100) return { ...base, status: "skipped", completedAt: Date.now(), error: "Текст слишком короткий (< 100 симв.)" };
  try {
    // Официальный API: POST https://turgenev.ashmanov.com/ с параметрами api=risk&key=&text=
    const form = new URLSearchParams();
    form.set("api", "risk");
    form.set("key", key);
    form.set("text", plain);
    const res = await fetchJson("https://turgenev.ashmanov.com/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }, 60000);
    const body = res.body as {
      risk?: number | string;
      level?: string;
      link?: string;
      error?: string;
    } | null;
    const score = num(body?.risk);
    if (!res.ok || score === undefined) {
      return { ...base, status: "failed", completedAt: Date.now(), error: body?.error ?? `HTTP ${res.status}`, rawJson: safeStringify(res.body) };
    }
    const risk: ProviderResult["turgenevRiskLevel"] =
      score >= 13 ? "critical" : score >= 8 ? "high" : score >= 5 ? "medium" : "ok";
    return {
      ...base,
      status: "success",
      completedAt: Date.now(),
      turgenevScore: score,
      turgenevRiskLevel: risk,
      reportUrl: body?.link ? `https://turgenev.ashmanov.com/?t=${body.link}` : undefined,
      rawJson: safeStringify(res.body),
    };
  } catch (e) {
    return { ...base, status: "failed", completedAt: Date.now(), error: (e as Error).message };
  }
}

async function sha1(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const checkTextQuality = createServerFn({ method: "POST" })
  .inputValidator((data: { text: string }) => data)
  .handler(async ({ data }): Promise<QualityCheckResult> => {
    const plain = stripHtml(data.text ?? "");
    const requestedAt = Date.now();
    const textHash = await sha1(plain);
    const [tr, zg, tg] = await Promise.all([
      checkTextRu(plain),
      checkZeroGpt(plain),
      checkTurgenev(plain),
    ]);
    return { textHash, requestedAt, completedAt: Date.now(), providers: [tr, zg, tg] };
  });

export async function hashText(text: string): Promise<string> {
  const plain = stripHtml(text);
  return sha1(plain);
}
