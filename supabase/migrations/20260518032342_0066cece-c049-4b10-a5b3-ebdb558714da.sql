
-- Close out rentals whose end date has passed
UPDATE public.rentals
SET reservation_status = 'completed', updated_at = now()
WHERE end_date IS NOT NULL
  AND end_date < CURRENT_DATE
  AND COALESCE(reservation_status, 'active') <> 'completed';

-- Recompute vehicle availability based on remaining non-completed rentals
UPDATE public.vehicles v
SET status = 'available', updated_at = now()
WHERE v.status = 'rented'
  AND NOT EXISTS (
    SELECT 1 FROM public.rentals r
    WHERE r.vehicle_id = v.id
      AND COALESCE(r.reservation_status, 'active') IN ('active', 'pending')
      AND r.start_date <= CURRENT_DATE
      AND (r.end_date IS NULL OR r.end_date >= CURRENT_DATE)
  );
