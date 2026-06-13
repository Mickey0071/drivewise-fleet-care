-- Extend expenses with richer fields
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS maintenance_id text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS reference_number text,
  ADD COLUMN IF NOT EXISTS payroll_employee text,
  ADD COLUMN IF NOT EXISTS payroll_period_start date,
  ADD COLUMN IF NOT EXISTS payroll_period_end date,
  ADD COLUMN IF NOT EXISTS payroll_hours numeric,
  ADD COLUMN IF NOT EXISTS payroll_rate numeric;

-- Mark default categories
ALTER TABLE public.expense_categories
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Seed default categories (idempotent)
INSERT INTO public.expense_categories (name, is_default)
SELECT v.name, true
FROM (VALUES
  ('Payroll'),('Parts'),('Labour'),('Food / Meals'),('Fuel'),('Insurance'),
  ('Registration'),('Office Supplies'),('Marketing'),('Tolls'),
  ('Cleaning Supplies'),('Vehicle Purchase')
) AS v(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.expense_categories c WHERE lower(c.name) = lower(v.name)
);

UPDATE public.expense_categories SET is_default = true
WHERE lower(name) IN (
  'payroll','parts','labour','food / meals','fuel','insurance','registration',
  'office supplies','marketing','tolls','cleaning supplies','vehicle purchase'
);

-- Audit log for expense changes
CREATE TABLE IF NOT EXISTS public.expense_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_id text NOT NULL,
  action text NOT NULL,
  diff jsonb,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.expense_audit_log TO authenticated;
GRANT ALL ON public.expense_audit_log TO service_role;

ALTER TABLE public.expense_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view expense audit log"
ON public.expense_audit_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert expense audit log"
ON public.expense_audit_log FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));