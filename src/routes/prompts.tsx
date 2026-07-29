import { createFileRoute, ClientOnly, useSearch, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { z } from "zod";
import { useStore } from "@/lib/store";
import type { PromptTemplate, Query } from "@/lib/types";
import {
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  PROMPT_VARIABLES,
  previewPrompt,
} from "@/lib/openai.functions";
import { listApiKeys, setApiKey, deleteApiKey, type ApiKeyStatus } from "@/lib/apiKeys.functions";
import { getLsiSettings, setLsiSettings } from "@/lib/lsi.functions";
import { LsiPanel } from "@/components/LsiPanel";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound, RotateCcw, Save, Settings, Sparkles, Trash2, Wand2 } from "lucide-react";



export const Route = createFileRoute("/prompts")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "SEO GGSEL — настройки" },
      { name: "description", content: "Настройки SEO GGSEL: AI-промты, требования к текстам, API-ключи и внешние подключения." },
      { property: "og:title", content: "SEO GGSEL — настройки" },
      { property: "og:description", content: "AI-промты, требования к текстам, API-ключи и внешние подключения." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  validateSearch: z.object({
    tab: z.enum(["prompts", "requirements", "apikeys"]).optional(),
  }),
  component: () => (
    <ClientOnly fallback={null}>
      <PromptsPage />
    </ClientOnly>
  ),
});


const GLOBAL_KEY = "__default";

/** Resolve prompt for a folder: folder-specific > global default > hard-coded. */
export function resolvePrompt(
  prompts: Record<string, PromptTemplate>,
  folder: string,
): Required<Pick<PromptTemplate, "systemPrompt" | "userPrompt" | "model">> {
  const folderP = prompts[folder] ?? {};
  const globalP = prompts[GLOBAL_KEY] ?? {};
  return {
    systemPrompt: folderP.systemPrompt ?? globalP.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    userPrompt: folderP.userPrompt ?? globalP.userPrompt ?? DEFAULT_PROMPT_TEMPLATE,
    model: folderP.model ?? globalP.model ?? "gpt-4o-mini",
  };
}

function PromptsPage() {
  const search = useSearch({ from: "/prompts" });
  const navigate = useNavigate({ from: "/prompts" });
  const activeTab = search.tab ?? "prompts";

  const queries = useStore((s) => s.queries);
  const prompts = useStore((s) => s.prompts);
  const setPrompt = useStore((s) => s.setPrompt);
  const resetPromptStore = useStore((s) => s.resetPrompt);

  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const q of queries) if (q.folder) set.add(q.folder);
    return Array.from(set).sort();
  }, [queries]);

  const [target, setTarget] = useState<string>(GLOBAL_KEY);
  const resolved = resolvePrompt(prompts, target === GLOBAL_KEY ? "" : target);
  const isOverridden = !!prompts[target];

  const [systemDraft, setSystemDraft] = useState(resolved.systemPrompt);
  const [userDraft, setUserDraft] = useState(resolved.userPrompt);
  const [model, setModel] = useState(resolved.model);
  const [dirtyKey, setDirtyKey] = useState<string>(target);

  // When switching target folder, reload draft from resolved.
  if (dirtyKey !== target) {
    setDirtyKey(target);
    setSystemDraft(resolved.systemPrompt);
    setUserDraft(resolved.userPrompt);
    setModel(resolved.model);
  }

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  const sampleQuery: Query | undefined = useMemo(() => {
    const pool = target === GLOBAL_KEY ? queries : queries.filter((q) => q.folder === target);
    return pool[0];
  }, [queries, target]);

  const sampleUrl = sampleQuery?.url ?? "https://ggsel.net/example";
  const sampleFolder = sampleQuery?.folder ?? (target === GLOBAL_KEY ? "/example/" : target);
  const sampleGroup = sampleQuery?.group ?? "Пример категории";

  const samplePhrases = useMemo(() => {
    const pool = queries.filter((q) => (target === GLOBAL_KEY ? true : q.folder === target));
    return pool.slice(0, 30).map((q) => ({
      phrase: q.phrase,
      frequency: q.frequency,
      googlePosition: q.googlePosition,
      yandexPosition: q.yandexPosition,
    }));
  }, [queries, target]);

  const preview = useMemo(
    () =>
      previewPrompt({
        url: sampleUrl,
        folder: sampleFolder,
        group: sampleGroup,
        phrases: samplePhrases,
        promptTemplate: userDraft,
        systemPrompt: systemDraft,
      }),
    [sampleUrl, sampleFolder, sampleGroup, samplePhrases, userDraft, systemDraft],
  );

  function insertVariable(name: string) {
    const el = textAreaRef.current;
    const token = `{${name}}`;
    if (!el) {
      setUserDraft((v) => v + token);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setUserDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function save() {
    setPrompt(target, { systemPrompt: systemDraft, userPrompt: userDraft, model });
    toast.success(
      target === GLOBAL_KEY ? "Сохранено: глобальный промт" : `Сохранено: ${target}`,
    );
  }

  function resetToDefault() {
    resetPromptStore(target);
    const base =
      target === GLOBAL_KEY
        ? { systemPrompt: DEFAULT_SYSTEM_PROMPT, userPrompt: DEFAULT_PROMPT_TEMPLATE, model: "gpt-4o-mini" }
        : resolvePrompt({ ...prompts, [target]: undefined as unknown as PromptTemplate }, target);
    setSystemDraft(base.systemPrompt ?? DEFAULT_SYSTEM_PROMPT);
    setUserDraft(base.userPrompt ?? DEFAULT_PROMPT_TEMPLATE);
    setModel(base.model ?? "gpt-4o-mini");
    toast.success("Сброшено до значения по умолчанию");
  }

  return (
    <AppShell>
      <div className="flex items-end justify-between mb-4 gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold">Настройки</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Управление шаблонами AI-промтов и требованиями к текстам.
          </p>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(v) => navigate({ search: { tab: v } })}
        className="w-full"
      >
        <TabsList className="mb-4">
          <TabsTrigger value="prompts" className="gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> AI Промты
          </TabsTrigger>
          <TabsTrigger value="requirements">Требования и примеры текстов</TabsTrigger>
          <TabsTrigger value="apikeys" className="gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> API и Ключи
          </TabsTrigger>
        </TabsList>


        <TabsContent value="prompts" className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-sm text-muted-foreground">
              Отдельный шаблон промта для каждой папки. Переменные подставляются автоматически.
            </div>
            <div className="flex gap-2 items-center">
              <Select value={target} onValueChange={setTarget}>
                <SelectTrigger className="w-64 h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={GLOBAL_KEY}>
                    Глобальный (по умолчанию)
                  </SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f} {prompts[f] ? "•" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button
                type="button"
                onClick={resetToDefault}
                disabled={!isOverridden && target !== GLOBAL_KEY}
                className="h-9 px-3 text-xs rounded-md border border-border hover:bg-accent disabled:opacity-40 inline-flex items-center gap-1"
                title="Сбросить до значения по умолчанию"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Сброс
              </button>
              <button
                type="button"
                onClick={save}
                className="h-9 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 inline-flex items-center gap-1"
              >
                <Save className="h-3.5 w-3.5" /> Сохранить
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  System prompt
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-muted-foreground">Модель</label>
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="h-7 w-40 text-xs"
                    placeholder="gpt-4o-mini"
                  />
                </div>
              </div>
              <textarea
                value={systemDraft}
                onChange={(e) => setSystemDraft(e.target.value)}
                className="w-full min-h-[80px] rounded-md border border-border bg-background p-3 text-sm font-mono resize-y"
                placeholder={DEFAULT_SYSTEM_PROMPT}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  User prompt (шаблон)
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Используйте <code className="px-1 rounded bg-muted">{"{variable}"}</code> для подстановки
                </div>
              </div>
              <textarea
                ref={textAreaRef}
                value={userDraft}
                onChange={(e) => setUserDraft(e.target.value)}
                className="w-full min-h-[380px] rounded-md border border-border bg-background p-3 text-sm font-mono resize-y"
                placeholder={DEFAULT_PROMPT_TEMPLATE}
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Предпросмотр (на основе первой записи{target === GLOBAL_KEY ? "" : ` папки ${target}`})
              </div>
              <div className="text-[11px] text-muted-foreground">
                URL: {sampleUrl} · Категория: {sampleGroup} · Фраз: {samplePhrases.length}
              </div>
              <pre className="whitespace-pre-wrap text-xs bg-muted/40 rounded-md p-3 max-h-[420px] overflow-auto">
{preview.system}
{"\n\n— — —\n\n"}
{preview.user}
              </pre>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 space-y-2">
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-1">
                Переменные (клик — вставить)
              </div>
              <div className="flex flex-col gap-1.5">
                {PROMPT_VARIABLES.map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    onClick={() => insertVariable(v.name)}
                    className="text-left px-2.5 py-1.5 rounded-md border border-border hover:bg-accent transition group"
                  >
                    <div className="text-xs font-mono text-primary">{`{${v.name}}`}</div>
                    <div className="text-[11px] text-muted-foreground leading-snug">
                      {v.description}
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 space-y-1.5 text-[11px] text-muted-foreground">
              <div className="font-medium text-foreground text-xs">Как это работает</div>
              <div>• Промт папки имеет приоритет над глобальным.</div>
              <div>• Точкой (•) отмечены папки с собственным промтом.</div>
              <div>• Переменные подставляются на сервере перед вызовом OpenAI.</div>
              <div>• Модель можно менять на любую совместимую с Chat Completions.</div>
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="requirements" className="space-y-4">
          <RequirementsTab />
        </TabsContent>

        <TabsContent value="apikeys" className="space-y-4">
          <ApiKeysPanel />
        </TabsContent>

      </Tabs>
    </AppShell>
  );
}

function useFolderList() {
  const queries = useStore((s) => s.queries);
  return useMemo(() => {
    const set = new Set<string>();
    for (const q of queries) if (q.folder) set.add(q.folder);
    return Array.from(set).sort();
  }, [queries]);
}

function FolderScopeSelect({
  value,
  onChange,
  marked,
}: {
  value: string;
  onChange: (v: string) => void;
  marked?: Set<string>;
}) {
  const folders = useFolderList();
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 text-xs w-56"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={GLOBAL_KEY}>Глобально (по умолчанию)</SelectItem>
        {folders.map((f) => (
          <SelectItem key={f} value={f}>
            {f} {marked?.has(f) ? "•" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WriterRequirementsPanel({ scope }: { scope: string }) {
  const map = useStore((s) => s.writerRequirements);
  const setValue = useStore((s) => s.setWriterRequirements);

  const effective = map[scope] ?? (scope !== GLOBAL_KEY ? map[GLOBAL_KEY] ?? "" : "");
  const [draft, setDraft] = useState(effective);
  const [scopeSync, setScopeSync] = useState(scope);
  if (scope !== scopeSync) {
    setScopeSync(scope);
    setDraft(effective);
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm font-medium">Требования к тексту (плейсхолдер в редакторе)</div>
            <div className="text-xs text-muted-foreground">
              Отображается в попапе копирайтера вместо стандартного «Начните писать текст…». Своё значение для каждого стрима с фолбэком на глобальное.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setDraft(""); setValue(scope, ""); toast.success("Требования очищены"); }}
              className="h-9 px-3 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Очистить
            </button>
            <button
              type="button"
              onClick={() => { setValue(scope, draft); toast.success("Требования сохранены"); }}
              className="h-9 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1"
            >
              <Save className="h-3.5 w-3.5" /> Сохранить
            </button>
          </div>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={8}
          placeholder="Например: объём 2500–3500 знаков; структура H2/H3; вхождения ключей в первых 500 знаках; списки, таблицы; тон — экспертный."
          className="w-full min-h-[160px] rounded-md border border-border bg-background p-3 text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </CardContent>
    </Card>
  );
}

function QualityThresholdsPanel({ scope }: { scope: string }) {
  const map = useStore((s) => s.qualityThresholds);
  const setQT = useStore((s) => s.setQualityThresholds);
  const resetQT = useStore((s) => s.resetQualityThresholds);

  const thresholds = map[scope] ?? map[GLOBAL_KEY];

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const patch = (p: Parameters<typeof setQT>[1]) => setQT(scope, p);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-medium">Пороги качества текста</div>
              <div className="text-xs text-muted-foreground">
                Свои пороги для каждого стрима. Если для стрима не задано — используются глобальные значения.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { resetQT(scope); toast.success(scope === GLOBAL_KEY ? "Глобальные значения сброшены" : "Пороги стрима сброшены"); }}
                className="h-9 px-3 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Сброс
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ThresholdCard
          title="Text.ru — Уникальность"
          hint="Процент уникальности. Чем выше — тем лучше."
          fields={[
            { label: "OK, если ≥", value: thresholds.unique.ok, onChange: (v) => patch({ unique: { ...thresholds.unique, ok: num(v) } }), suffix: "%" },
            { label: "Warning, если ≥", value: thresholds.unique.warn, onChange: (v) => patch({ unique: { ...thresholds.unique, warn: num(v) } }), suffix: "%" },
          ]}
          footer="Ниже второго порога — Fail."
        />

        <ThresholdCard
          title="Text.ru — Вода"
          hint="Чем ниже, тем лучше."
          fields={[
            { label: "Warning, если ≥", value: thresholds.water.warn, onChange: (v) => patch({ water: { ...thresholds.water, warn: num(v) } }), suffix: "%" },
            { label: "Fail, если >", value: thresholds.water.fail, onChange: (v) => patch({ water: { ...thresholds.water, fail: num(v) } }), suffix: "%" },
          ]}
        />

        <ThresholdCard
          title="Text.ru — Заспамленность"
          hint="Чем ниже, тем лучше."
          fields={[
            { label: "Warning, если ≥", value: thresholds.spam.warn, onChange: (v) => patch({ spam: { ...thresholds.spam, warn: num(v) } }), suffix: "%" },
            { label: "Fail, если >", value: thresholds.spam.fail, onChange: (v) => patch({ spam: { ...thresholds.spam, fail: num(v) } }), suffix: "%" },
          ]}
        />

        <ThresholdCard
          title="ZeroGPT — AI-контент"
          hint="Процент вероятности AI-генерации. Чем ниже, тем лучше."
          fields={[
            { label: "Warning, если ≥", value: thresholds.ai.warn, onChange: (v) => patch({ ai: { ...thresholds.ai, warn: num(v) } }), suffix: "%" },
            { label: "Fail, если >", value: thresholds.ai.fail, onChange: (v) => patch({ ai: { ...thresholds.ai, fail: num(v) } }), suffix: "%" },
          ]}
        />

        <ThresholdCard
          title="Тургенев (Ашманов) — Риск"
          hint="Баллы риска переспама. Чем ниже, тем лучше."
          fields={[
            { label: "Warning, если ≥", value: thresholds.turgenev.warn, onChange: (v) => patch({ turgenev: { ...thresholds.turgenev, warn: num(v) } }), suffix: "б" },
            { label: "Fail, если ≥", value: thresholds.turgenev.fail, onChange: (v) => patch({ turgenev: { ...thresholds.turgenev, fail: num(v) } }), suffix: "б" },
            { label: "Critical, если ≥", value: thresholds.turgenev.critical, onChange: (v) => patch({ turgenev: { ...thresholds.turgenev, critical: num(v) } }), suffix: "б" },
          ]}
        />
      </div>

      <Card>
        <CardContent className="p-4 space-y-1.5 text-[11px] text-muted-foreground">
          <div className="font-medium text-foreground text-xs">Как считается общий статус</div>
          <div>• Каждой метрике присваивается зона: OK / Warning / Fail / Critical.</div>
          <div>• Общий статус текста — худшая зона среди всех проверок.</div>
          <div>• Пороги применяются по стриму URL; если для стрима не задано — берутся глобальные.</div>
        </CardContent>
      </Card>
    </div>
  );
}

function RequirementsTab() {
  const [scope, setScope] = useState(GLOBAL_KEY);
  const writerReqMap = useStore((s) => s.writerRequirements);
  const qtMap = useStore((s) => s.qualityThresholds);

  const marked = useMemo(() => {
    const set = new Set<string>();
    for (const k of Object.keys(writerReqMap)) if (k !== GLOBAL_KEY) set.add(k);
    for (const k of Object.keys(qtMap)) if (k !== GLOBAL_KEY) set.add(k);
    return set;
  }, [writerReqMap, qtMap]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium">Стрим / папка</div>
            <div className="text-xs text-muted-foreground">
              Глобальный переключатель стрима для всех настроек этого раздела.
            </div>
          </div>
          <FolderScopeSelect value={scope} onChange={setScope} marked={marked} />
        </CardContent>
      </Card>

      <WriterRequirementsPanel scope={scope} />
      <QualityThresholdsPanel scope={scope} />
    </div>
  );
}

interface ThresholdField {
  label: string;
  value: number;
  onChange: (v: string) => void;
  suffix?: string;
}

function ThresholdCard({ title, hint, fields, footer }: { title: string; hint?: string; fields: ThresholdField[]; footer?: string }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
        </div>
        <div className="grid grid-cols-1 gap-2">
          {fields.map((f) => (
            <label key={f.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">{f.label}</span>
              <span className="inline-flex items-center gap-1">
                <Input
                  type="number"
                  value={f.value}
                  onChange={(e) => f.onChange(e.target.value)}
                  className="h-8 w-20 text-xs text-right"
                />
                {f.suffix && <span className="text-muted-foreground text-[11px]">{f.suffix}</span>}
              </span>
            </label>
          ))}
        </div>
        {footer && <div className="text-[11px] text-muted-foreground">{footer}</div>}
      </CardContent>
    </Card>
  );
}

const API_KEY_META: Record<string, { label: string; hint: string; docsUrl?: string; placeholder?: string }> = {
  OPENAI_API_KEY: {
    label: "OpenAI",
    hint: "Используется для автогенерации мета-тегов.",
    docsUrl: "https://platform.openai.com/api-keys",
    placeholder: "sk-...",
  },
  TEXT_RU_USERKEY: {
    label: "Text.ru",
    hint: "Проверка уникальности, воды и заспамленности.",
    docsUrl: "https://text.ru/api-check",
  },
  ZEROGPT_API_KEY: {
    label: "ZeroGPT",
    hint: "Определение AI-контента.",
    docsUrl: "https://www.zerogpt.com/api",
  },
  TURGENEV_API_KEY: {
    label: "Тургенев (Ашманов)",
    hint: "Оценка риска переоптимизации.",
    docsUrl: "https://turgenev.ashmanov.com/",
  },
  TOPVISOR_USER_ID: {
    label: "Topvisor User ID",
    hint: "ID пользователя Topvisor (заголовок User-Id).",
    docsUrl: "https://topvisor.com/api/",
    placeholder: "12345",
  },
  TOPVISOR_API_KEY: {
    label: "Topvisor API Key",
    hint: "Ключ Topvisor для сбора конкурентов из SERP.",
    docsUrl: "https://topvisor.com/api/",
  },
  MIRATEXT_API_KEY: {
    label: "Miratext API Key",
    hint: "Анализ LSI/тошноты/воды у конкурентных URL.",
    docsUrl: "https://miratext.ru/",
  },
  XMLRIVER_USER: {
    label: "XMLRiver User ID",
    hint: "ID пользователя xmlriver.com для Wordstat (сезонность).",
    docsUrl: "http://xmlriver.com/",
    placeholder: "14608",
  },
  XMLRIVER_KEY: {
    label: "XMLRiver API Key",
    hint: "Ключ xmlriver.com для запросов Wordstat/сезонности.",
    docsUrl: "http://xmlriver.com/",
  },
};


function ApiKeysPanel() {
  const listFn = useServerFn(listApiKeys);
  const setFn = useServerFn(setApiKey);
  const delFn = useServerFn(deleteApiKey);
  const [items, setItems] = useState<ApiKeyStatus[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function reload() {
    setLoading(true);
    try {
      const res = await listFn();
      setItems(res);
    } catch (e) {
      toast.error(`Не удалось загрузить: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-1">
          <div className="text-sm font-medium">API-ключи проекта</div>
          <div className="text-xs text-muted-foreground">
            Значения хранятся на сервере и подставляются автоматически. Ключ, сохранённый здесь,
            имеет приоритет над переменной окружения — можно быстро заменить без деплоя.
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(items ?? []).map((item) => (
          <ApiKeyCard
            key={item.name}
            item={item}
            meta={API_KEY_META[item.name] ?? { label: item.name, hint: "" }}
            onSave={async (value) => {
              await setFn({ data: { name: item.name, value } });
              toast.success(`${API_KEY_META[item.name]?.label ?? item.name} — сохранён`);
              await reload();
            }}
            onDelete={async () => {
              await delFn({ data: { name: item.name } });
              toast.success(`${API_KEY_META[item.name]?.label ?? item.name} — удалён из БД`);
              await reload();
            }}
          />
        ))}
        {items === null && (
          <div className="text-xs text-muted-foreground">{loading ? "Загрузка…" : ""}</div>
        )}
      </div>

      <LsiSettingsPanel />
    </div>

  );
}

function ApiKeyCard({
  item,
  meta,
  onSave,
  onDelete,
}: {
  item: ApiKeyStatus;
  meta: { label: string; hint: string; docsUrl?: string; placeholder?: string };
  onSave: (value: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  const badge = item.hasValue
    ? item.source === "db"
      ? { text: "Сохранён (БД)", cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" }
      : { text: "Из окружения", cls: "bg-sky-500/15 text-sky-600 border-sky-500/30" }
    : { text: "Не задан", cls: "bg-rose-500/15 text-rose-600 border-rose-500/30" };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{meta.label}</div>
            <div className="text-[11px] text-muted-foreground leading-snug">{meta.hint}</div>
            <div className="text-[11px] text-muted-foreground font-mono mt-1">{item.name}</div>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
        </div>

        <div className="text-[11px] text-muted-foreground">
          Текущий: <span className="font-mono">{item.preview ?? "—"}</span>
          {item.updatedAt && ` · обновлён ${new Date(item.updatedAt).toLocaleString()}`}
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              type={show ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={meta.placeholder ?? "Вставьте новый ключ…"}
              className="h-9 pr-9 text-xs font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          <button
            type="button"
            disabled={!draft.trim() || busy}
            onClick={async () => {
              setBusy(true);
              try { await onSave(draft.trim()); setDraft(""); }
              catch (e) { toast.error((e as Error).message); }
              finally { setBusy(false); }
            }}
            className="h-9 px-3 text-xs rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 inline-flex items-center gap-1"
          >
            <Save className="h-3.5 w-3.5" /> Сохранить
          </button>
          {item.source === "db" && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Удалить сохранённый ${meta.label}?`)) return;
                setBusy(true);
                try { await onDelete(); }
                catch (e) { toast.error((e as Error).message); }
                finally { setBusy(false); }
              }}
              className="h-9 px-2 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
              title="Удалить из БД (останется значение из окружения, если есть)"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {meta.docsUrl && (
          <a href={meta.docsUrl} target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline">
            Где взять ключ →
          </a>
        )}
      </CardContent>
    </Card>
  );
}


// ---------------------------------------------------------------------------
// LSI / Topvisor settings (moved from «Требования и примеры текстов»).
// External connection settings live alongside API keys.
// ---------------------------------------------------------------------------

function LsiSettingsPanel() {
  const getS = useServerFn(getLsiSettings);
  const setS = useServerFn(setLsiSettings);
  const [scope, setScope] = useState<string>(GLOBAL_KEY);
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof getLsiSettings>> | null>(null);
  const [blDraft, setBlDraft] = useState("");
  const overriddenFolders = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    let cancelled = false;
    getS({ data: { folder: scope } as never })
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setBlDraft(s.blacklist_domains.join(", "));
      })
      .catch((e) => toast.error((e as Error).message));
    return () => { cancelled = true; };
  }, [scope, getS]);

  async function save(patch: Partial<NonNullable<typeof settings>>) {
    const next = await setS({ data: { folder: scope, patch } as never });
    setSettings(next);
    setBlDraft(next.blacklist_domains.join(", "));
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Sparkles className="h-4 w-4 text-primary" />
          <div className="text-sm font-medium">LSI и конкуренты — параметры подключения</div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Стрим:</span>
            <FolderScopeSelect value={scope} onChange={setScope} marked={overriddenFolders} />
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Настройки Topvisor-проекта для сбора конкурентов из SERP и последующего анализа через Miratext.
          Ключи <code>TOPVISOR_USER_ID</code>, <code>TOPVISOR_API_KEY</code>, <code>MIRATEXT_API_KEY</code> задаются в карточках выше.
          {scope !== GLOBAL_KEY && (
            <span className="block mt-1">
              Применяется к стриму <b>{scope}</b>. Пустые поля наследуются из глобальных.
            </span>
          )}
        </div>

        {!settings ? (
          <div className="text-xs text-muted-foreground">Загрузка настроек…</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SettingsField label="Topvisor project_id">
              <Input
                value={settings.topvisor_project_id ?? ""}
                onChange={(e) => setSettings({ ...settings, topvisor_project_id: e.target.value })}
                onBlur={() => save({ topvisor_project_id: settings.topvisor_project_id })}
                className="h-8 text-xs"
              />
            </SettingsField>
            <SettingsField label="Поисковик (ПС)">
              <Select
                value={settings.search_engine}
                onValueChange={(v) => { setSettings({ ...settings, search_engine: v }); save({ search_engine: v }); }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="google">Google</SelectItem>
                  <SelectItem value="yandex">Yandex</SelectItem>
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label="Глубина SERP">
              <Select
                value={String(settings.serp_depth)}
                onValueChange={(v) => { setSettings({ ...settings, serp_depth: Number(v) }); save({ serp_depth: Number(v) }); }}
              >
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">TOP-10</SelectItem>
                  <SelectItem value="20">TOP-20</SelectItem>
                  <SelectItem value="30">TOP-30</SelectItem>
                </SelectContent>
              </Select>
            </SettingsField>
            <SettingsField label="Кол-во конкурентов">
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.competitor_count}
                onChange={(e) => setSettings({ ...settings, competitor_count: Number(e.target.value) || 3 })}
                onBlur={() => save({ competitor_count: settings.competitor_count })}
                className="h-8 text-xs"
              />
            </SettingsField>
            <SettingsField label="Домен проекта (исключить)">
              <Input
                value={settings.project_domain}
                onChange={(e) => setSettings({ ...settings, project_domain: e.target.value })}
                onBlur={() => save({ project_domain: settings.project_domain })}
                className="h-8 text-xs"
              />
            </SettingsField>
            <SettingsField label="Blacklist доменов (через запятую)" className="col-span-2">
              <Input
                value={blDraft}
                onChange={(e) => setBlDraft(e.target.value)}
                onBlur={() => {
                  const list = blDraft.split(",").map((x) => x.trim()).filter(Boolean);
                  setSettings({ ...settings, blacklist_domains: list });
                  save({ blacklist_domains: list });
                }}
                className="h-8 text-xs"
              />
            </SettingsField>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SettingsField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="text-[11px] text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
