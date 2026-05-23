DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'rentals',
    'drivers',
    'payments',
    'expenses',
    'vehicle_photos',
    'insurance_entries',
    'insurance_claim_checklist',
    'staff',
    'payroll_runs',
    'payroll_lines'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- Ensure UPDATE payloads carry the full row for the rentals table so the
-- client-side store always sees the latest reservation_status / returned_at.
ALTER TABLE public.rentals REPLICA IDENTITY FULL;
ALTER TABLE public.vehicles REPLICA IDENTITY FULL;