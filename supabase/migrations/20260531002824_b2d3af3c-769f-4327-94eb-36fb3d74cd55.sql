CREATE TABLE public.repair_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.repair_types TO authenticated;
GRANT ALL ON public.repair_types TO service_role;

ALTER TABLE public.repair_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated full access"
ON public.repair_types
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);