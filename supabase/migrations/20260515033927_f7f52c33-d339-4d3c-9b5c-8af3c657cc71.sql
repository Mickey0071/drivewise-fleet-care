
-- Expenses table
CREATE TABLE public.expenses (
  id TEXT PRIMARY KEY DEFAULT ('exp_' || substr(gen_random_uuid()::text, 1, 12)),
  vehicle_id TEXT REFERENCES public.vehicles(id) ON DELETE SET NULL,
  category TEXT NOT NULL CHECK (category IN ('fuel','repair','maintenance','insurance','registration','lien_payment','payroll','cleaning','towing','impound','other')),
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor TEXT,
  notes TEXT,
  receipt_url TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_expenses_date ON public.expenses(date DESC);
CREATE INDEX idx_expenses_vehicle ON public.expenses(vehicle_id);
CREATE INDEX idx_expenses_category ON public.expenses(category);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read expenses" ON public.expenses
  FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert expenses" ON public.expenses
  FOR INSERT TO authenticated WITH CHECK (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update expenses" ON public.expenses
  FOR UPDATE TO authenticated USING (has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete expenses" ON public.expenses
  FOR DELETE TO authenticated USING (has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Storage bucket for receipts (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Admins read receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'expense-receipts' AND has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins upload receipts" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'expense-receipts' AND has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update receipts" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'expense-receipts' AND has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'expense-receipts' AND has_role(auth.uid(), 'admin'));
