-- LSI global settings (single row)
CREATE TABLE public.lsi_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topvisor_project_id text,
  topvisor_region_index integer,
  search_engine text NOT NULL DEFAULT 'google',
  serp_depth integer NOT NULL DEFAULT 10,
  competitor_count integer NOT NULL DEFAULT 3,
  project_domain text NOT NULL DEFAULT 'ggsel.net',
  blacklist_domains text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.lsi_settings TO service_role;
ALTER TABLE public.lsi_settings ENABLE ROW LEVEL SECURITY;

-- Analysis runs
CREATE TABLE public.text_requirement_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL,
  folder text,
  group_name text,
  target_url text,
  status text NOT NULL DEFAULT 'draft',
  topvisor_project_id text,
  topvisor_region_index integer,
  search_engine text,
  serp_depth integer,
  serp_date timestamptz,
  competitor_count integer,
  miratext_hash text,
  error_message text,
  raw_topvisor_response jsonb,
  raw_miratext_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.text_requirement_analysis TO service_role;
ALTER TABLE public.text_requirement_analysis ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tra_group_key ON public.text_requirement_analysis(group_key);

-- Competitor URLs per analysis
CREATE TABLE public.text_requirement_competitor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES public.text_requirement_analysis(id) ON DELETE CASCADE,
  url text NOT NULL,
  domain text,
  position numeric,
  keyword_count integer,
  avg_position numeric,
  source text,
  is_selected boolean NOT NULL DEFAULT true,
  is_excluded boolean NOT NULL DEFAULT false,
  exclude_reason text,
  snippet_title text,
  snippet_body text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.text_requirement_competitor TO service_role;
ALTER TABLE public.text_requirement_competitor ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_trc_analysis ON public.text_requirement_competitor(analysis_id);

-- LSI items (words / phrases)
CREATE TABLE public.text_requirement_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id uuid NOT NULL REFERENCES public.text_requirement_analysis(id) ON DELETE CASCADE,
  type text NOT NULL,             -- word | phrase_2 | phrase_3 | stopword | note | example_good | example_bad | block
  value text NOT NULL,
  source_field text,
  recommended_count integer,
  min_count integer,
  max_count integer,
  density numeric,
  competitor_site_count integer,
  priority text,                  -- high | medium | low
  status text NOT NULL DEFAULT 'recommended', -- required | recommended | optional | excluded
  is_manual boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.text_requirement_item TO service_role;
ALTER TABLE public.text_requirement_item ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_tri_analysis ON public.text_requirement_item(analysis_id);

-- Versions per group
CREATE TABLE public.text_requirement_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key text NOT NULL,
  analysis_id uuid REFERENCES public.text_requirement_analysis(id) ON DELETE SET NULL,
  version_number integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft', -- draft | active | archived
  change_comment text,
  recommended_length_min integer,
  recommended_length_max integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);
GRANT ALL ON public.text_requirement_version TO service_role;
ALTER TABLE public.text_requirement_version ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_trv_group_status ON public.text_requirement_version(group_key, status);