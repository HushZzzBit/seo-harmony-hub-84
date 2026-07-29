# Единый реестр владения URL (URL Ownership Registry)

Цель: устранить рассинхрон при атрибуции URL → группа/папка. Один авторитетный источник для всех разделов.

## Источники истины (по слоям)

| Слой | Источник | Куда пишется |
|---|---|---|
| Владение URL (folder + group) | DataLens `base_category` > Topvisor relevant > Topvisor target | `url_ownership` |
| Бизнес-метрики (GMV, визиты, заказы) | DataLens | как сейчас, но группа берётся из `url_ownership` |
| SEO-метрики (позиции, TOP-N) | Topvisor snapshots | как сейчас |
| Ключи, частотность | Topvisor | как сейчас |
| Сезонность | XMLRiver / ручной CSV | как сейчас |

## Правила регистра владения

1. Ключ строки — `normalized_url` (без домена, без протокола, trailing slash отрезан).
2. При конфликте побеждает более частая (mode) атрибуция того же приоритетного уровня — «самый частый» победитель.
3. Полностью автоматически — без ручных переопределений.
4. Пересборка триггерится автоматически после:
   - импорта DataLens Categories/Start URL,
   - «Подтянуть данные» из Topvisor.
5. В дашборде показываются только те URL, у которых `normalized_url` присутствует в выгрузке Topvisor (пересечение).

## Изменения

### БД (миграция)

```
CREATE TABLE public.url_ownership (
  normalized_url text PRIMARY KEY,
  folder text,
  "group" text,
  source text NOT NULL,        -- 'datalens_base' | 'tv_relevant' | 'tv_target'
  confidence int NOT NULL,     -- 100/80/60
  hit_count int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.url_ownership TO authenticated, anon;
GRANT ALL ON public.url_ownership TO service_role;
ALTER TABLE public.url_ownership ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read ownership" ON public.url_ownership FOR SELECT USING (true);
```

### Сервер

- `src/lib/ownership.server.ts` — `rebuildOwnership()`: собирает голоса из `datalens_category_metric` (по `base_category`, вес 100), `datalens_start_url_metric` (matched_group_id, вес 80 — только если DataLens URL присутствует в Topvisor), падает на Topvisor мапу (relevant 60, target 40). Финализация: mode по (folder,group) на URL.
- `src/lib/ownership.functions.ts` — `rebuildOwnership` (serverFn) + `getOwnership` (public read).

### Клиент

- `src/lib/store.ts` — `ownership: Record<string, {folder, group}>` + `loadOwnership()`.
- `src/components/DashboardDataLensTabs.tsx` — `useUrlOwnershipMap` берёт данные из `store.ownership` (а не собирает локально). `filterByFolder`: группа URL = `ownership[norm].group`, fallback игнорируется. Дополнительно: `intersectWithTopvisor` — фильтр URL, которые есть в Topvisor queries/urls.
- `src/routes/import.tsx` — после импорта DataLens и после «Подтянуть данные» вызывается `rebuildOwnership` → `loadOwnership`.
- `src/components/DataLensImportPanel.tsx` — по завершении импорта триггерит пересборку.

### Мелкое

- В `datalens-match.ts` name-fallback (`matched_by_name`, `matched_by_slug`) больше не влияет на UI — dashboard игнорирует их. Оставляем только для отчёта matching-summary.

## Что получает пользователь

- Одинаковые группы URL во всех вкладках (Дашборд, Meta, Texts, DataLens).
- GMV/визиты Google Drive и подобных больше не «утекают» в чужие группы.
- В URL-аналитике показываются только URL, которые реально есть в Topvisor-проекте.
