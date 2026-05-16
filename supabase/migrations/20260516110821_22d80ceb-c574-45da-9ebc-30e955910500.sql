
CREATE TABLE public.insurance_entries (
  id text PRIMARY KEY DEFAULT ('ins_' || substr(gen_random_uuid()::text, 1, 12)),
  vehicle_id text,
  type text NOT NULL CHECK (type IN ('premium','claim')),
  claim_type text,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  notes text,
  policy_number text,
  claim_number text,
  status text NOT NULL DEFAULT 'closed' CHECK (status IN ('open','closed')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.insurance_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read insurance_entries" ON public.insurance_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write insurance_entries" ON public.insurance_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER insurance_entries_touch BEFORE UPDATE ON public.insurance_entries
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.insurance_claim_checklist (
  id text PRIMARY KEY DEFAULT ('icl_' || substr(gen_random_uuid()::text, 1, 12)),
  entry_id text NOT NULL REFERENCES public.insurance_entries(id) ON DELETE CASCADE,
  label text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_icl_entry ON public.insurance_claim_checklist(entry_id);

ALTER TABLE public.insurance_claim_checklist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read icl" ON public.insurance_claim_checklist FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated write icl" ON public.insurance_claim_checklist FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.seed_claim_checklist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  steps text[] := ARRAY[
    'Take photos of all damage (vehicle, scene, other party)',
    'Collect other driver license, insurance, plate',
    'File police report; capture report number',
    'Call insurance to open claim; capture claim number',
    'Upload photos and documents',
    'Get repair estimate(s)',
    'Schedule repair / total-loss inspection',
    'Confirm rental coverage / loaner',
    'Track payout received'
  ];
  i int;
BEGIN
  IF NEW.type = 'claim' THEN
    FOR i IN 1..array_length(steps, 1) LOOP
      INSERT INTO public.insurance_claim_checklist (entry_id, label, sort_order)
      VALUES (NEW.id, steps[i], i);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER insurance_entries_seed_checklist
AFTER INSERT ON public.insurance_entries
FOR EACH ROW EXECUTE FUNCTION public.seed_claim_checklist();
