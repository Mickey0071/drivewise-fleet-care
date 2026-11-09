CREATE TABLE public.rto_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id text,
  vehicle_id text,
  customer_name text NOT NULL DEFAULT '',
  address text DEFAULT '',
  city_state_zip text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  license_number text DEFAULT '',
  vehicle_year text DEFAULT '',
  vehicle_make text DEFAULT '',
  vehicle_model text DEFAULT '',
  vehicle_color text DEFAULT '',
  vin text DEFAULT '',
  plate text DEFAULT '',
  odometer text DEFAULT '',
  agreement_date date NOT NULL DEFAULT current_date,
  down_payment numeric NOT NULL DEFAULT 1500,
  weekly_amount numeric NOT NULL DEFAULT 225,
  num_payments integer NOT NULL DEFAULT 14,
  late_fee_per_day numeric NOT NULL DEFAULT 25,
  cancel_fee numeric NOT NULL DEFAULT 250,
  first_due_date date,
  status text NOT NULL DEFAULT 'draft',
  sign_token text UNIQUE,
  sent_at timestamptz,
  customer_signature text,
  customer_signed_name text,
  signed_at timestamptz,
  rep_signed_name text,
  staff_seen boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rto_contracts TO authenticated;
GRANT ALL ON public.rto_contracts TO service_role;
ALTER TABLE public.rto_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage rto contracts" ON public.rto_contracts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.rto_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.rto_contracts(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  late_fee numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'cash',
  paid_at date NOT NULL DEFAULT current_date,
  note text,
  stripe_session_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rto_payments TO authenticated;
GRANT ALL ON public.rto_payments TO service_role;
ALTER TABLE public.rto_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage rto payments" ON public.rto_payments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));