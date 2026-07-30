CREATE TABLE public.external_group_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'datalens_categories',
  external_name_raw text NOT NULL,
  external_name_normalized text NOT NULL,
  matched_group_id text,
  matched_folder text,
  match_type text NOT NULL DEFAULT 'manual',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, external_name_normalized)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.external_group_mapping TO authenticated;
GRANT SELECT ON public.external_group_mapping TO anon;
GRANT ALL ON public.external_group_mapping TO service_role;

ALTER TABLE public.external_group_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read external_group_mapping" ON public.external_group_mapping FOR SELECT USING (true);
CREATE POLICY "service_role manages external_group_mapping" ON public.external_group_mapping FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_egm_norm ON public.external_group_mapping (source, external_name_normalized);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_egm_updated_at BEFORE UPDATE ON public.external_group_mapping
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();