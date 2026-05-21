ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS activated_at timestamptz;

-- Backfill existing active rentals with their updated_at so the 2h check-in SMS
-- doesn't trigger retroactively for rentals already in flight.
UPDATE public.rentals
SET activated_at = COALESCE(updated_at, created_at, now())
WHERE reservation_status = 'active' AND activated_at IS NULL;