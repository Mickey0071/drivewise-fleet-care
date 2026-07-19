
CREATE TABLE public.user_nav_layout (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  position text NOT NULL DEFAULT 'nav',
  is_starred_shortcut boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_nav_layout_position_check CHECK (position IN ('nav','shortcut')),
  CONSTRAINT user_nav_layout_unique UNIQUE (user_id, item_key, position)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_nav_layout TO authenticated;
GRANT ALL ON public.user_nav_layout TO service_role;

ALTER TABLE public.user_nav_layout ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own nav layout"
  ON public.user_nav_layout
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX user_nav_layout_user_pos_idx
  ON public.user_nav_layout (user_id, position, sort_order);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_user_nav_layout_updated_at
  BEFORE UPDATE ON public.user_nav_layout
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
