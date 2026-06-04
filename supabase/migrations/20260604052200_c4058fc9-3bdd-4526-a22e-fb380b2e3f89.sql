-- Repair history (fleet card) + scorecard data for completed repairs
CREATE TABLE public.repair_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  maintenance_id TEXT,
  repair_date DATE NOT NULL,
  issue TEXT,
  parts TEXT,
  parts_cost NUMERIC NOT NULL DEFAULT 0,
  labor_cost NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  mechanic_name TEXT,
  completed_by TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.repair_history TO authenticated;
GRANT ALL ON public.repair_history TO service_role;
ALTER TABLE public.repair_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view repair history" ON public.repair_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert repair history" ON public.repair_history FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update repair history" ON public.repair_history FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete repair history" ON public.repair_history FOR DELETE TO authenticated USING (true);

CREATE TABLE public.repair_scorecard (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  vehicle_id TEXT NOT NULL,
  maintenance_id TEXT,
  repair_date DATE NOT NULL,
  cost NUMERIC NOT NULL DEFAULT 0,
  issue_category TEXT,
  days_in_repair INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.repair_scorecard TO authenticated;
GRANT ALL ON public.repair_scorecard TO service_role;
ALTER TABLE public.repair_scorecard ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view scorecard" ON public.repair_scorecard FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert scorecard" ON public.repair_scorecard FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update scorecard" ON public.repair_scorecard FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated can delete scorecard" ON public.repair_scorecard FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_repair_history_updated_at BEFORE UPDATE ON public.repair_history FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_repair_scorecard_updated_at BEFORE UPDATE ON public.repair_scorecard FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Ensure the Repair & Maintenance expense category exists
INSERT INTO public.expense_categories (name)
SELECT 'Repair & Maintenance'
WHERE NOT EXISTS (SELECT 1 FROM public.expense_categories WHERE name = 'Repair & Maintenance');