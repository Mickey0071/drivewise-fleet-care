-- Add billing columns to rentals
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS billing_cadence TEXT CHECK (billing_cadence IN ('daily','weekly')) DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS rate_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS auto_renew BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS current_period_end DATE;

-- Backfill billing_cadence from existing billing_period
UPDATE public.rentals
SET billing_cadence = CASE
  WHEN lower(coalesce(billing_period,'weekly')) = 'daily' THEN 'daily'
  ELSE 'weekly'
END
WHERE billing_cadence IS NULL OR billing_cadence NOT IN ('daily','weekly');

-- Backfill rate_amount from rate -> weekly_rate (or daily_rate*7) where possible
UPDATE public.rentals r
SET rate_amount = CASE
  WHEN r.rate IS NOT NULL AND r.rate > 0 THEN r.rate
  WHEN r.billing_cadence = 'daily' THEN
    COALESCE(NULLIF((SELECT v.daily_rate FROM public.vehicles v WHERE v.id = r.vehicle_id), 0), NULLIF(r.weekly_rate,0) / 7.0)
  ELSE COALESCE(NULLIF(r.weekly_rate, 0),
                NULLIF((SELECT v.weekly_rate FROM public.vehicles v WHERE v.id = r.vehicle_id), 0))
END
WHERE rate_amount IS NULL;

-- Backfill auto_renew = true for active rentals (default already true)
UPDATE public.rentals
SET auto_renew = true
WHERE auto_renew IS NULL;

-- Backfill current_period_end: advance from start_date by cadence until >= today
UPDATE public.rentals
SET current_period_end = (
  CASE
    WHEN start_date IS NULL THEN NULL
    WHEN start_date >= CURRENT_DATE THEN start_date
    ELSE start_date + (
      CEIL(GREATEST(CURRENT_DATE - start_date, 0)::numeric
           / CASE WHEN billing_cadence = 'daily' THEN 1 ELSE 7 END)::int
      * CASE WHEN billing_cadence = 'daily' THEN 1 ELSE 7 END
    )
  END
)
WHERE current_period_end IS NULL;
