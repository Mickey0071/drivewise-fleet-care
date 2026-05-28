
ALTER TABLE public.violations
  ADD COLUMN IF NOT EXISTS rental_id text,
  ADD COLUMN IF NOT EXISTS license_plate text,
  ADD COLUMN IF NOT EXISTS fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS photo_url text,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_link_id text,
  ADD COLUMN IF NOT EXISTS payment_link_url text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE INDEX IF NOT EXISTS idx_violations_rental ON public.violations(rental_id);
CREATE INDEX IF NOT EXISTS idx_violations_vehicle ON public.violations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_violations_status ON public.violations(status);
CREATE INDEX IF NOT EXISTS idx_violations_date ON public.violations(date_issued DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='violations' AND policyname='Service role manages violations'
  ) THEN
    CREATE POLICY "Service role manages violations"
      ON public.violations FOR ALL
      TO public
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'violations_touch_updated_at'
  ) THEN
    CREATE TRIGGER violations_touch_updated_at
      BEFORE UPDATE ON public.violations
      FOR EACH ROW
      EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END $$;
