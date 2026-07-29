
DROP POLICY IF EXISTS "auth read datalens_import" ON public.datalens_import;
DROP POLICY IF EXISTS "auth write datalens_import" ON public.datalens_import;
DROP POLICY IF EXISTS "auth update datalens_import" ON public.datalens_import;
DROP POLICY IF EXISTS "auth delete datalens_import" ON public.datalens_import;
DROP POLICY IF EXISTS "auth all datalens_cat" ON public.datalens_category_metric;
DROP POLICY IF EXISTS "auth all datalens_url" ON public.datalens_start_url_metric;

REVOKE ALL ON public.datalens_import FROM authenticated;
REVOKE ALL ON public.datalens_category_metric FROM authenticated;
REVOKE ALL ON public.datalens_start_url_metric FROM authenticated;

CREATE POLICY "service_role manages datalens_import" ON public.datalens_import FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages datalens_cat" ON public.datalens_category_metric FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role manages datalens_url" ON public.datalens_start_url_metric FOR ALL TO service_role USING (true) WITH CHECK (true);
