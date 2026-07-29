
-- ============ datalens_import ============
CREATE TABLE public.datalens_import (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('categories','start_url')),
  stream text,
  period_start date,
  period_end date,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  file_name text,
  comment text,
  rows_total integer NOT NULL DEFAULT 0,
  rows_matched integer NOT NULL DEFAULT 0,
  rows_unmatched integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ready',
  error_log jsonb
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datalens_import TO authenticated;
GRANT ALL ON public.datalens_import TO service_role;
ALTER TABLE public.datalens_import ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read datalens_import" ON public.datalens_import FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth write datalens_import" ON public.datalens_import FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update datalens_import" ON public.datalens_import FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete datalens_import" ON public.datalens_import FOR DELETE TO authenticated USING (true);
CREATE INDEX idx_datalens_import_type_stream ON public.datalens_import(type, stream, uploaded_at DESC);

-- ============ datalens_category_metric ============
CREATE TABLE public.datalens_category_metric (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.datalens_import(id) ON DELETE CASCADE,
  category_id text,
  category_name text,
  category_url text,
  normalized_url text,
  level integer,
  active_goods numeric,
  sellers numeric,
  gmv numeric,
  base_id text,
  base_category text,
  goods_in_base numeric,
  sellers_in_base numeric,
  first_child text,
  second_child text,
  third_child text,
  matched_url_id text,
  matched_group_id text,
  match_status text NOT NULL DEFAULT 'unmatched',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datalens_category_metric TO authenticated;
GRANT ALL ON public.datalens_category_metric TO service_role;
ALTER TABLE public.datalens_category_metric ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all datalens_cat" ON public.datalens_category_metric FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_dl_cat_import ON public.datalens_category_metric(import_id);
CREATE INDEX idx_dl_cat_norm ON public.datalens_category_metric(normalized_url);

-- ============ datalens_start_url_metric ============
CREATE TABLE public.datalens_start_url_metric (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.datalens_import(id) ON DELETE CASCADE,
  page_name text,
  page_type text,
  url text,
  normalized_url text,
  visits numeric,
  users numeric,
  new_users_percent numeric,
  bounce_rate numeric,
  page_depth numeric,
  average_visit_sec numeric,
  visit_to_click_buy numeric,
  visit_to_order numeric,
  orders numeric,
  gmv numeric,
  aov numeric,
  arpu numeric,
  arppu numeric,
  yandex_traffic_percent numeric,
  google_traffic_percent numeric,
  matched_url_id text,
  matched_group_id text,
  match_status text NOT NULL DEFAULT 'unmatched',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.datalens_start_url_metric TO authenticated;
GRANT ALL ON public.datalens_start_url_metric TO service_role;
ALTER TABLE public.datalens_start_url_metric ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth all datalens_url" ON public.datalens_start_url_metric FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_dl_url_import ON public.datalens_start_url_metric(import_id);
CREATE INDEX idx_dl_url_norm ON public.datalens_start_url_metric(normalized_url);
