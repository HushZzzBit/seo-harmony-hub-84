export type Status = "not_started" | "in_progress" | "in_csv" | "done";
export type Priority = "high" | "medium" | "low";
export type TextStatus = "not_assigned" | "in_progress" | "review" | "ready" | "in_csv" | "done";

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

export interface MetaEdit {
  url: string;
  title?: string;
  description?: string;
  h1?: string;
  status?: Status;
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
