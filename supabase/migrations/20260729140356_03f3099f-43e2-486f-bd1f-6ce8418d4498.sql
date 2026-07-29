CREATE TABLE public.url_ownership (
  normalized_url text PRIMARY KEY,
  folder text,
  "group" text,
  source text NOT NULL,
  confidence int NOT NULL DEFAULT 0,
  hit_count int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.url_ownership TO anon, authenticated;
GRANT ALL ON public.url_ownership TO service_role;
ALTER TABLE public.url_ownership ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read url_ownership" ON public.url_ownership FOR SELECT USING (true);
CREATE POLICY "service_role manages url_ownership" ON public.url_ownership FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_url_ownership_group ON public.url_ownership ("group");
CREATE INDEX idx_url_ownership_folder ON public.url_ownership (folder);