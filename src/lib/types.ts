export type Status = "not_started" | "in_progress" | "in_csv" | "done";
export type Priority = "high" | "medium" | "low";
export type TextStatus = "not_assigned" | "copywriting" | "expansion" | "revision" | "ready" | "in_csv" | "done";

export interface Query {
  id: string;
  phrase: string;
  folder: string;
  group: string;
  url?: string;
  frequency: number;
  googlePosition?: number;
  yandexPosition?: number;
  seasonality: number[]; // 12 months
}

export interface UrlRow {
  url: string;
  folder?: string;
  group?: string;
  title?: string;
  description?: string;
  h1?: string;
  textLength?: number;
  hasText?: boolean;
  text?: string;
}

export type MetaSource = "ai" | "manual" | "ai+manual";

export interface MetaEdit {
  url: string;
  title?: string;
  description?: string;
  h1?: string;
  status?: Status;
  source?: MetaSource;
  updatedAt?: number;
}

export interface MetaHistoryEntry {
  url: string;
  field: "title" | "description" | "h1";
  oldValue: string;
  newValue: string;
  at: number;
}

export interface TextRow {
  url: string;
  productName?: string;
  plannedMonth?: number; // 0-11
  plannedLength?: number;
  assignee?: string;
  status: TextStatus;
  text?: string;
  updatedAt?: number;
}

export interface FolderState {
  folder: string;
  status: Status;
  plannedDate?: string;
  lastImport?: number;
}

export interface GroupState {
  status: Status;
  plannedDate?: string;
}

export interface PromptTemplate {
  systemPrompt?: string;
  userPrompt?: string;
  model?: string;
  updatedAt?: number;
}

export type QualityProvider = "text_ru" | "zerogpt" | "turgenev";
export type QualityProviderStatus = "pending" | "success" | "failed" | "skipped";
export type QualityOverall = "checking" | "ok" | "warning" | "fail" | "error";

export interface QualityProviderResult {
  provider: QualityProvider;
  status: QualityProviderStatus;
  requestedAt: number;
  completedAt?: number;
  error?: string;
  reportUrl?: string;
  waterPercent?: number;
  spamPercent?: number;
  uniquePercent?: number;
  aiPercent?: number;
  turgenevScore?: number;
  turgenevRiskLevel?: "ok" | "medium" | "high" | "critical";
}

export interface TextQualityCheck {
  url: string;
  textHash: string;
  /** Символьная длина проверенного plain-text — для сравнения на «мало изменилось». */
  textLength?: number;
  requestedAt: number;
  completedAt?: number;
  overall: QualityOverall;
  providers: QualityProviderResult[];
  /** Сколько раз запускалась проверка для этого URL (лимит — 5). */
  runCount?: number;
}


