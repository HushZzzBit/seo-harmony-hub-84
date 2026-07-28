ALTER TABLE public.lsi_settings ADD COLUMN IF NOT EXISTS folder text;
CREATE UNIQUE INDEX IF NOT EXISTS lsi_settings_folder_uniq ON public.lsi_settings ((COALESCE(folder, '__default')));