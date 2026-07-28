import type { QualityOverall, QualityProviderResult, QualityThresholds, TextQualityCheck } from "./types";

export type Zone = "ok" | "warning" | "fail" | "critical" | "unknown";

export const providerLabel: Record<string, string> = {
  text_ru: "Text.ru",
  zerogpt: "ZeroGPT",
  turgenev: "Тургенев",
};

/** Значения по умолчанию. Пользователь меняет их в Настройках → Требования и примеры текстов. */
export const DEFAULT_THRESHOLDS: QualityThresholds = {
  unique: { ok: 85, warn: 70 },
  water: { warn: 15, fail: 20 },
  spam: { warn: 45, fail: 55 },
  ai: { warn: 30, fail: 60 },
  turgenev: { warn: 5, fail: 8, critical: 13 },
};

/** Мутируемая копия — обновляется из стора (см. useStore.qualityThresholds). */
export const THRESHOLDS: QualityThresholds = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));

export function applyThresholds(next: Partial<QualityThresholds> | undefined) {
  if (!next) return;
  THRESHOLDS.unique = { ...THRESHOLDS.unique, ...(next.unique ?? {}) };
  THRESHOLDS.water = { ...THRESHOLDS.water, ...(next.water ?? {}) };
  THRESHOLDS.spam = { ...THRESHOLDS.spam, ...(next.spam ?? {}) };
  THRESHOLDS.ai = { ...THRESHOLDS.ai, ...(next.ai ?? {}) };
  THRESHOLDS.turgenev = { ...THRESHOLDS.turgenev, ...(next.turgenev ?? {}) };
}

function zoneByBands(v: number, warn: number, fail: number): Zone {
  if (v < warn) return "ok";
  if (v <= fail) return "warning";
  return "fail";
}

export type MetricView = { label: string; value: string; zone: Zone };

export function providerMetricsWith(T: QualityThresholds, p: QualityProviderResult): MetricView[] {
  if (p.status !== "success") return [];
  const m: MetricView[] = [];
  if (p.provider === "text_ru") {
    if (p.uniquePercent !== undefined) {
      const u = p.uniquePercent;
      const zone: Zone = u >= T.unique.ok ? "ok" : u >= T.unique.warn ? "warning" : "fail";
      m.push({ label: "Уник.", value: `${u.toFixed(1)}%`, zone });
    }
    if (p.waterPercent !== undefined) {
      m.push({ label: "Вода", value: `${p.waterPercent.toFixed(1)}%`, zone: zoneByBands(p.waterPercent, T.water.warn, T.water.fail) });
    }
    if (p.spamPercent !== undefined) {
      m.push({ label: "Заспам.", value: `${p.spamPercent.toFixed(1)}%`, zone: zoneByBands(p.spamPercent, T.spam.warn, T.spam.fail) });
    }
  } else if (p.provider === "zerogpt" && p.aiPercent !== undefined) {
    m.push({ label: "AI", value: `${p.aiPercent.toFixed(1)}%`, zone: zoneByBands(p.aiPercent, T.ai.warn, T.ai.fail) });
  } else if (p.provider === "turgenev" && p.turgenevScore !== undefined) {
    const s = p.turgenevScore;
    const zone: Zone = s >= T.turgenev.critical ? "critical" : s >= T.turgenev.fail ? "fail" : s >= T.turgenev.warn ? "warning" : "ok";
    m.push({ label: "Риск", value: s.toFixed(1), zone });
  }
  return m;
}

export function providerMetrics(p: QualityProviderResult): MetricView[] {
  return providerMetricsWith(THRESHOLDS, p);
}

const rank: Record<Zone, number> = { ok: 0, unknown: 0, warning: 1, fail: 2, critical: 3 };

export function overallFromCheckWith(T: QualityThresholds, check: TextQualityCheck): QualityOverall {
  const hasPending = check.providers.some((p) => p.status === "pending");
  if (hasPending && !check.completedAt) return "checking";
  let worst: Zone = "ok";
  let anySuccess = false;
  let anyFailed = false;
  for (const p of check.providers) {
    if (p.status === "failed") anyFailed = true;
    if (p.status !== "success") continue;
    anySuccess = true;
    for (const m of providerMetricsWith(T, p)) {
      if (rank[m.zone] > rank[worst]) worst = m.zone;
    }
  }
  if (!anySuccess && anyFailed) return "error";
  if (worst === "critical" || worst === "fail") return "fail";
  if (worst === "warning") return "warning";
  return "ok";
}

export function overallFromCheck(check: TextQualityCheck): QualityOverall {
  return overallFromCheckWith(THRESHOLDS, check);
}

export const overallLabel: Record<QualityOverall, string> = {
  checking: "Проверка качества",
  ok: "Готово к проверке SEO",
  warning: "Требует внимания",
  fail: "На доработку",
  error: "Ошибка проверки",
};

export const zoneClass: Record<Zone, string> = {
  ok: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30",
  warning: "bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30",
  fail: "bg-rose-500/15 text-rose-600 dark:text-rose-300 border-rose-500/30",
  critical: "bg-rose-600/20 text-rose-700 dark:text-rose-200 border-rose-600/40",
  unknown: "bg-muted text-muted-foreground border-border",
};

export const overallDot: Record<QualityOverall, string> = {
  checking: "bg-sky-500 animate-pulse",
  ok: "bg-emerald-500",
  warning: "bg-amber-500",
  fail: "bg-rose-500",
  error: "bg-muted-foreground",
};
