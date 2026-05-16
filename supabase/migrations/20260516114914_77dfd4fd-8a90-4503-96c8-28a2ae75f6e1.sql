
-- Extend insurance_entries with header fields from the accident checklist
ALTER TABLE public.insurance_entries
  ADD COLUMN IF NOT EXISTS company text,
  ADD COLUMN IF NOT EXISTS renter_name text,
  ADD COLUMN IF NOT EXISTS renter_phone text;

-- Extend checklist items with per-task fields
ALTER TABLE public.insurance_claim_checklist
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS amount numeric,
  ADD COLUMN IF NOT EXISTS requires_amount boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_document boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS document_url text,
  ADD COLUMN IF NOT EXISTS document_name text;

-- Rewrite seed trigger to insert the 8 accident-checklist tasks
CREATE OR REPLACE FUNCTION public.seed_claim_checklist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  steps text[] := ARRAY[
    'Incident Report',
    'Police Report',
    'Photos of Damages',
    'Repair Estimate',
    'Actual Cash Value',
    'Rental Receipt',
    'Loss of Use Demand (1099 previous year)',
    'Loss of Use Demand (Previous Week to accident)'
  ];
  amount_flags boolean[] := ARRAY[false, false, false, true, true, true, true, true];
  i int;
BEGIN
  IF NEW.type = 'claim' THEN
    FOR i IN 1..array_length(steps, 1) LOOP
      INSERT INTO public.insurance_claim_checklist
        (entry_id, label, sort_order, requires_amount, requires_document)
      VALUES (NEW.id, steps[i], i, amount_flags[i], true);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$;

-- Storage bucket for uploaded claim docs (police report, photos, estimates...)
INSERT INTO storage.buckets (id, name, public)
VALUES ('claim-documents', 'claim-documents', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies
DROP POLICY IF EXISTS "Public read claim documents" ON storage.objects;
CREATE POLICY "Public read claim documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'claim-documents');

DROP POLICY IF EXISTS "Authenticated upload claim documents" ON storage.objects;
CREATE POLICY "Authenticated upload claim documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'claim-documents');

DROP POLICY IF EXISTS "Authenticated update claim documents" ON storage.objects;
CREATE POLICY "Authenticated update claim documents"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'claim-documents');

DROP POLICY IF EXISTS "Authenticated delete claim documents" ON storage.objects;
CREATE POLICY "Authenticated delete claim documents"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'claim-documents');
