import { createServerFn } from "@tanstack/react-start";

export type PromptPhrase = {
  phrase: string;
  frequency?: number;
  googlePosition?: number;
  yandexPosition?: number;
};

type GenInput = {
  url: string;
  folder: string;
  group: string;
  phrases: PromptPhrase[];
  currentTitle?: string;
  currentDescription?: string;
  currentH1?: string;
  /** Custom user prompt template with {variables}. If omitted, uses default. */
  promptTemplate?: string;
  /** Custom system prompt. If omitted, uses default. */
  systemPrompt?: string;
  /** Model override; default gpt-4o-mini. */
  model?: string;
};

type GenResult = { title: string; description: string; h1: string };

export const DEFAULT_SYSTEM_PROMPT =
  "Ты опытный SEO-специалист маркетплейса цифровых товаров GGSEL. Отвечай строго валидным JSON без пояснений.";

export const DEFAULT_PROMPT_TEMPLATE = `Сгенерируй мета-теги для страницы категории на русском языке.

URL: {url}
Папка: {folder}
Категория: {group}

Ключевые фразы (по убыванию частоты):
{phrases}

{current_block}
Требования:
- Title: до 60 символов, включи главный ключ, добавь "купить" или "GGSEL"
- Description: до 160 символов, продающий, с призывом к действию и УТП (быстро, недорого, гарантия)
- H1: короткий, естественный, содержит главный ключ
- Не используй CAPS LOCK и переспам ключей
- Пиши естественно, для людей

Верни строго JSON: {"title":"...","description":"...","h1":"..."}`;

export const PROMPT_VARIABLES: { name: string; description: string }[] = [
  { name: "url", description: "URL страницы категории" },
  { name: "folder", description: "Папка (например /non-gaming/)" },
  { name: "group", description: "Название категории/группы" },
  { name: "phrases", description: "Список топ-30 ключевых фраз с частотой (по строкам)" },
  { name: "phrases_list", description: "Топ-30 ключевых фраз через запятую" },
  { name: "phrases_table", description: "Топ-30 фраз с частотой и позициями Google/Yandex" },
  { name: "keywords", description: "Уникальные слова из ключевых фраз через запятую" },
  { name: "top_google", description: "Топ фраз, где сайт уже в TOP-10 Google" },
  { name: "top_yandex", description: "Топ фраз, где сайт уже в TOP-10 Yandex" },
  { name: "currentTitle", description: "Текущий Title (если есть)" },
  { name: "currentDescription", description: "Текущий Description (если есть)" },
  { name: "currentH1", description: "Текущий H1 (если есть)" },
  { name: "current_block", description: "Блок с текущими Title/Description/H1 (если заполнены)" },
];

function buildVariables(input: GenInput): Record<string, string> {
  const sorted = [...input.phrases].sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0));
  const top = sorted.slice(0, 30);

  const phrases = top
    .map((p) => `- ${p.phrase}${p.frequency ? ` (частота: ${p.frequency})` : ""}`)
    .join("\n");

  const phrases_list = top.map((p) => p.phrase).join(", ");

  const phrases_table = top
    .map((p) => {
      const parts = [p.phrase];
      if (p.frequency) parts.push(`ч:${p.frequency}`);
      if (p.googlePosition) parts.push(`G:${p.googlePosition}`);
      if (p.yandexPosition) parts.push(`Y:${p.yandexPosition}`);
      return `- ${parts.join(" | ")}`;
    })
    .join("\n");

  const words = new Set<string>();
  for (const p of top) {
    for (const w of p.phrase.toLowerCase().split(/[^a-zа-я0-9]+/i)) {
      if (w.length > 2) words.add(w);
    }
  }
  const keywords = Array.from(words).slice(0, 50).join(", ");

  const top_google = sorted
    .filter((p) => p.googlePosition && p.googlePosition > 0 && p.googlePosition <= 10)
    .slice(0, 15)
    .map((p) => `- ${p.phrase} (${p.googlePosition})`)
    .join("\n");

  const top_yandex = sorted
    .filter((p) => p.yandexPosition && p.yandexPosition > 0 && p.yandexPosition <= 10)
    .slice(0, 15)
    .map((p) => `- ${p.phrase} (${p.yandexPosition})`)
    .join("\n");

  const currentTitle = input.currentTitle ?? "";
  const currentDescription = input.currentDescription ?? "";
  const currentH1 = input.currentH1 ?? "";

  const currentParts: string[] = [];
  if (currentTitle) currentParts.push(`Текущий Title: ${currentTitle}`);
  if (currentDescription) currentParts.push(`Текущий Description: ${currentDescription}`);
  if (currentH1) currentParts.push(`Текущий H1: ${currentH1}`);
  const current_block = currentParts.length ? currentParts.join("\n") + "\n" : "";

  return {
    url: input.url,
    folder: input.folder,
    group: input.group,
    phrases,
    phrases_list,
    phrases_table,
    keywords,
    top_google,
    top_yandex,
    currentTitle,
    currentDescription,
    currentH1,
    current_block,
  };
}

export function renderPrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, name: string) => vars[name] ?? "");
}

export const generateMeta = createServerFn({ method: "POST" })
  .inputValidator((data: GenInput) => data)
  .handler(async ({ data }): Promise<GenResult> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not configured");

    const vars = buildVariables(data);
    const userPrompt = renderPrompt(data.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE, vars);
    const systemPrompt = data.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: data.model ?? "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${err.slice(0, 200)}`);
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(content) as Partial<GenResult>;

    return {
      title: (parsed.title ?? "").trim(),
      description: (parsed.description ?? "").trim(),
      h1: (parsed.h1 ?? "").trim(),
    };
  });

/** Client-side preview of the rendered prompt (no network). */
export function previewPrompt(input: GenInput): { system: string; user: string } {
  const vars = buildVariables(input);
  return {
    system: input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    user: renderPrompt(input.promptTemplate ?? DEFAULT_PROMPT_TEMPLATE, vars),
  };
}
