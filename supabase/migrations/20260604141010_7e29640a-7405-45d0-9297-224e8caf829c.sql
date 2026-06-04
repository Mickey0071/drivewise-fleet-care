ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS auto_pay_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_pay_cadence text,
  ADD COLUMN IF NOT EXISTS next_auto_charge_date timestamptz,
  ADD COLUMN IF NOT EXISTS auto_pay_started_date timestamptz;

ALTER TABLE public.auto_extension_offers
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS resent_count integer NOT NULL DEFAULT 0;