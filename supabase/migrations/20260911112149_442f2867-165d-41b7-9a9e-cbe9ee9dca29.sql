CREATE TABLE public.ram_expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_date DATE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  paid_by TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ram_expenses TO authenticated;
GRANT ALL ON public.ram_expenses TO service_role;
ALTER TABLE public.ram_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Team members can manage RAM expenses" ON public.ram_expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE OR REPLACE FUNCTION public.update_ram_expenses_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER update_ram_expenses_updated_at BEFORE UPDATE ON public.ram_expenses FOR EACH ROW EXECUTE FUNCTION public.update_ram_expenses_updated_at();