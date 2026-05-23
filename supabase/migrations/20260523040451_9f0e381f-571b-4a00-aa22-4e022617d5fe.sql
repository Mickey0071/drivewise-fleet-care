-- Expense categories table for dropdown
CREATE TABLE public.expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read expense_categories" ON public.expense_categories
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'runner'::app_role));

CREATE POLICY "Staff insert expense_categories" ON public.expense_categories
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'runner'::app_role));

CREATE POLICY "Admins delete expense_categories" ON public.expense_categories
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role));

-- Seed with default categories
INSERT INTO public.expense_categories (name) VALUES
  ('Fuel'),('Repair'),('Maintenance'),('Insurance'),('Registration'),
  ('Lien Payment'),('Payroll'),('Cleaning'),('Towing'),('Impound'),
  ('Parking'),('Gas'),('Office Supplies'),('Other')
ON CONFLICT (name) DO NOTHING;

-- Security fix: remove sensitive tables from realtime broadcast.
-- These contain PII / payment / signing data and broadcasts bypass per-row RLS.
ALTER PUBLICATION supabase_realtime DROP TABLE public.payments;
ALTER PUBLICATION supabase_realtime DROP TABLE public.drivers;
ALTER PUBLICATION supabase_realtime DROP TABLE public.rentals;