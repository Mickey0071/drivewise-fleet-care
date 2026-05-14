
-- Core fleet/rental tables for multi-device persistence

CREATE TABLE public.vehicles (
  id text PRIMARY KEY,
  make text NOT NULL,
  model text NOT NULL,
  year integer NOT NULL,
  vin text NOT NULL,
  plate text NOT NULL,
  mileage integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'available',
  risk_tier text NOT NULL DEFAULT 'A',
  daily_rate numeric NOT NULL DEFAULT 0,
  weekly_rate numeric NOT NULL DEFAULT 0,
  notes text,
  next_service_due date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.drivers (
  id text PRIMARY KEY,
  full_name text NOT NULL,
  phone text NOT NULL,
  email text NOT NULL,
  license_number text NOT NULL,
  license_expiry date NOT NULL,
  insurance_on_file boolean NOT NULL DEFAULT false,
  rideshare text NOT NULL DEFAULT 'Uber',
  status text NOT NULL DEFAULT 'active',
  date_added date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rentals (
  id text PRIMARY KEY,
  vehicle_id text NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  driver_id text NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  start_date date NOT NULL,
  end_date date,
  weekly_rate numeric NOT NULL DEFAULT 0,
  deposit_paid numeric NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'current',
  notes text,
  billing_period text,
  rate numeric,
  signature_data_url text,
  signed_at timestamptz,
  signed_by text,
  agreement_version text,
  reservation_status text DEFAULT 'pending',
  pending_created_at timestamptz,
  payment_received boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rentals_vehicle ON public.rentals(vehicle_id);
CREATE INDEX idx_rentals_driver ON public.rentals(driver_id);

CREATE TABLE public.rental_extensions (
  id text PRIMARY KEY,
  rental_id text NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  extended_at timestamptz NOT NULL DEFAULT now(),
  previous_end_date date,
  new_end_date date NOT NULL,
  periods integer NOT NULL,
  period_label text NOT NULL,
  additional_amount numeric NOT NULL DEFAULT 0,
  payment_id text,
  signature_data_url text,
  signed_by text,
  agreement_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_extensions_rental ON public.rental_extensions(rental_id);

CREATE TABLE public.payments (
  id text PRIMARY KEY,
  rental_id text NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  driver_id text NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  amount numeric NOT NULL,
  due_date date NOT NULL,
  paid_date date,
  method text,
  status text NOT NULL DEFAULT 'late',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_rental ON public.payments(rental_id);

CREATE TABLE public.inspections (
  id text PRIMARY KEY,
  vehicle_id text NOT NULL REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  rental_id text NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  type text NOT NULL,
  date date NOT NULL,
  mileage integer NOT NULL DEFAULT 0,
  fuel_level integer NOT NULL DEFAULT 100,
  damage_noted boolean NOT NULL DEFAULT false,
  completed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_inspections_rental ON public.inspections(rental_id);

-- updated_at triggers
CREATE TRIGGER trg_vehicles_updated BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_drivers_updated BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_rentals_updated BEFORE UPDATE ON public.rentals FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- RLS: internal staff app — any authenticated user can read & manage all rows.
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rentals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rental_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read vehicles" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write vehicles" ON public.vehicles FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read drivers" ON public.drivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write drivers" ON public.drivers FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read rentals" ON public.rentals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write rentals" ON public.rentals FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read extensions" ON public.rental_extensions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write extensions" ON public.rental_extensions FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read payments" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write payments" ON public.payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated read inspections" ON public.inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write inspections" ON public.inspections FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rentals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_extensions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inspections;
