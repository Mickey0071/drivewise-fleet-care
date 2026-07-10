CREATE TABLE public.user_ui_prefs (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  sidebar_layout JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_ui_prefs TO authenticated;
GRANT ALL ON public.user_ui_prefs TO service_role;

ALTER TABLE public.user_ui_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own UI prefs"
ON public.user_ui_prefs
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_user_ui_prefs_updated_at
BEFORE UPDATE ON public.user_ui_prefs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();