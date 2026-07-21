import { createServerFn } from "@tanstack/react-start";

type GenInput = {
  url: string;
  folder: string;
  group: string;
  phrases: { phrase: string; frequency?: number; googlePosition?: number; yandexPosition?: number }[];
  currentTitle?: string;
  currentDescription?: string;
  currentH1?: string;
};

type GenResult = { title: string; description: string; h1: string };

function buildPrompt(input: GenInput): string {
  const topPhrases = [...input.phrases]
    .sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0))
    .slice(0, 30)
    .map((p) => `- ${p.phrase}${p.frequency ? ` (частота: ${p.frequency})` : ""}`)
    .join("\n");

  return `Ты SEO-специалист для маркетплейса цифровых товаров GGSEL. Сгенерируй мета-теги для страницы категории на русском языке.

URL: ${input.url}
Папка: ${input.folder}
Категория: ${input.group}

Ключевые фразы (по убыванию частоты):
${topPhrases}

${input.currentTitle ? `Текущий Title: ${input.currentTitle}\n` : ""}${input.currentDescription ? `Текущий Description: ${input.currentDescription}\n` : ""}${input.currentH1 ? `Текущий H1: ${input.currentH1}\n` : ""}
Требования:
- Title: до 60 символов, включи главный ключ, добавь "купить" или "GGSEL"
- Description: до 160 символов, продающий, с призывом к действию и УТП (быстро, недорого, гарантия)
- H1: короткий, естественный, содержит главный ключ
- Не используй CAPS LOCK и переспам ключей
- Пиши естественно, для людей

Верни строго JSON без пояснений: {"title":"...","description":"...","h1":"..."}`;
}

export const generateMeta = createServerFn({ method: "POST" })
  .inputValidator((data: GenInput) => data)
  .handler(async ({ data }): Promise<GenResult> => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is not configured");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Ты опытный SEO-специалист. Отвечай строго валидным JSON." },
          { role: "user", content: buildPrompt(data) },
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
