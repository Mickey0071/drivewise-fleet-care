
-- VIOLATIONS
CREATE TABLE public.violations (
  id text PRIMARY KEY,
  vehicle_id text NOT NULL,
  driver_id text,
  type text NOT NULL DEFAULT 'ticket',
  amount numeric NOT NULL DEFAULT 0,
  date_issued date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read violations" ON public.violations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write violations" ON public.violations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_violations_updated BEFORE UPDATE ON public.violations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER PUBLICATION supabase_realtime ADD TABLE public.violations;

-- MAINTENANCE
CREATE TABLE public.maintenance (
  id text PRIMARY KEY,
  vehicle_id text NOT NULL,
  service_type text NOT NULL,
  vendor text NOT NULL,
  date_completed date NOT NULL DEFAULT CURRENT_DATE,
  mileage_at_service integer NOT NULL DEFAULT 0,
  cost numeric NOT NULL DEFAULT 0,
  next_service_due date NOT NULL DEFAULT CURRENT_DATE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.maintenance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read maintenance" ON public.maintenance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write maintenance" ON public.maintenance FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_maintenance_updated BEFORE UPDATE ON public.maintenance FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance;

-- STAFF
CREATE TABLE public.staff (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  pay_type text NOT NULL DEFAULT 'hourly',
  pay_rate numeric NOT NULL DEFAULT 0,
  stripe_connected boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read staff" ON public.staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write staff" ON public.staff FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_staff_updated BEFORE UPDATE ON public.staff FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff;

-- PAYROLL RUNS
CREATE TABLE public.payroll_runs (
  id text PRIMARY KEY,
  period_start date NOT NULL,
  period_end date NOT NULL,
  run_date date NOT NULL DEFAULT CURRENT_DATE,
  total_payout numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read payroll_runs" ON public.payroll_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write payroll_runs" ON public.payroll_runs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_payroll_runs_updated BEFORE UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
ALTER PUBLICATION supabase_realtime ADD TABLE public.payroll_runs;

-- PAYROLL LINES
CREATE TABLE public.payroll_lines (
  id text PRIMARY KEY DEFAULT ('prl_' || substr(gen_random_uuid()::text, 1, 12)),
  run_id text NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  staff_id text NOT NULL,
  hours numeric NOT NULL DEFAULT 0,
  vehicles integer NOT NULL DEFAULT 0,
  gross numeric NOT NULL DEFAULT 0,
  net numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated read payroll_lines" ON public.payroll_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write payroll_lines" ON public.payroll_lines FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_payroll_lines_run ON public.payroll_lines(run_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.payroll_lines;
