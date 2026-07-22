import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useStore } from "@/lib/store";
import type { PromptTemplate, Query } from "@/lib/types";
import {
  DEFAULT_PROMPT_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  PROMPT_VARIABLES,
  previewPrompt,
} from "@/lib/openai.functions";
import { toast } from "sonner";
import { RotateCcw, Save, Settings, Wand2 } from "lucide-react";

export const Route = createFileRoute("/prompts")({
  ssr: false,
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

      <Tabs defaultValue="prompts" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="prompts" className="gap-1.5">
            <Wand2 className="h-3.5 w-3.5" /> AI Промты
          </TabsTrigger>
          <TabsTrigger value="requirements">Требования и примеры текстов</TabsTrigger>
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

        <TabsContent value="requirements">
          <QualityThresholdsPanel />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function QualityThresholdsPanel() {
  const thresholds = useStore((s) => s.qualityThresholds);
  const setQualityThresholds = useStore((s) => s.setQualityThresholds);
  const resetQualityThresholds = useStore((s) => s.resetQualityThresholds);

  const num = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Пороги качества текста</div>
              <div className="text-xs text-muted-foreground">
                На основе этих значений автоматически присваивается общий статус качества (OK / Требует внимания / На доработку).
              </div>
            </div>
            <button
              type="button"
              onClick={() => { resetQualityThresholds(); toast.success("Сброшено до значений по умолчанию"); }}
              className="h-9 px-3 text-xs rounded-md border border-border hover:bg-accent inline-flex items-center gap-1"
            >
              <RotateCcw className="h-3.5 w-3.5" /> Сброс
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ThresholdCard
          title="Text.ru — Уникальность"
          hint="Процент уникальности. Чем выше — тем лучше."
          fields={[
            { label: "OK, если ≥", value: thresholds.unique.ok, onChange: (v) => setQualityThresholds({ unique: { ...thresholds.unique, ok: num(v) } }), suffix: "%" },
            { label: "Warning, если ≥", value: thresholds.unique.warn, onChange: (v) => setQualityThresholds({ unique: { ...thresholds.unique, warn: num(v) } }), suffix: "%" },
          ]}
          footer="Ниже второго порога — Fail."
        />

        <ThresholdCard
          title="Text.ru — Вода"
          hint="Чем ниже, тем лучше."
          fields={[
            { label: "Warning, если ≥", value: thresholds.water.warn, onChange: (v) => setQualityThresholds({ water: { ...thresholds.water, warn: num(v) } }), suffix: "%" },
            { label: "Fail, если >", value: thresholds.water.fail, onChange: (v) => setQualityThresholds({ water: { ...thresholds.water, fail: num(v) } }), suffix: "%" },
          ]}
        />

        <ThresholdCard
          title="Text.ru — Заспамленность"
          hint="Чем ниже, тем лучше."
          fields={[
            { label: "Warning, если ≥", value: thresholds.spam.warn, onChange: (v) => setQualityThresholds({ spam: { ...thresholds.spam, warn: num(v) } }), suffix: "%" },
            { label: "Fail, если >", value: thresholds.spam.fail, onChange: (v) => setQualityThresholds({ spam: { ...thresholds.spam, fail: num(v) } }), suffix: "%" },
          ]}
        />

        <ThresholdCard
          title="ZeroGPT — AI-контент"
          hint="Процент вероятности AI-генерации. Чем ниже, тем лучше."
          fields={[
            { label: "Warning, если ≥", value: thresholds.ai.warn, onChange: (v) => setQualityThresholds({ ai: { ...thresholds.ai, warn: num(v) } }), suffix: "%" },
            { label: "Fail, если >", value: thresholds.ai.fail, onChange: (v) => setQualityThresholds({ ai: { ...thresholds.ai, fail: num(v) } }), suffix: "%" },
          ]}
        />

        <ThresholdCard
          title="Тургенев (Ашманов) — Риск"
          hint="Баллы риска переспама. Чем ниже, тем лучше."
          fields={[
            { label: "Warning, если ≥", value: thresholds.turgenev.warn, onChange: (v) => setQualityThresholds({ turgenev: { ...thresholds.turgenev, warn: num(v) } }), suffix: "б" },
            { label: "Fail, если ≥", value: thresholds.turgenev.fail, onChange: (v) => setQualityThresholds({ turgenev: { ...thresholds.turgenev, fail: num(v) } }), suffix: "б" },
            { label: "Critical, если ≥", value: thresholds.turgenev.critical, onChange: (v) => setQualityThresholds({ turgenev: { ...thresholds.turgenev, critical: num(v) } }), suffix: "б" },
          ]}
        />
      </div>

      <Card>
        <CardContent className="p-4 space-y-1.5 text-[11px] text-muted-foreground">
          <div className="font-medium text-foreground text-xs">Как считается общий статус</div>
          <div>• Каждой метрике присваивается зона: OK / Warning / Fail / Critical.</div>
          <div>• Общий статус текста — худшая зона среди всех проверок.</div>
          <div>• Значения применяются сразу после сохранения — новые проверки и повторный вход в попап покажут актуальные зоны.</div>
        </CardContent>
      </Card>
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
