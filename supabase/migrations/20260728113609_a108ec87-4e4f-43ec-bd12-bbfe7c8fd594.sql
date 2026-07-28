CREATE TABLE public.api_keys (
  name text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.api_keys TO service_role;
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role manages api_keys" ON public.api_keys FOR ALL TO service_role USING (true) WITH CHECK (true);