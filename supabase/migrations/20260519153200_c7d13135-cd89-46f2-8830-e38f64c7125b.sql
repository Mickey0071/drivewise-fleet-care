-- STEP 1: clear stale returned_at on rentals that never actually closed out
UPDATE public.rentals
SET returned_at = NULL
WHERE id IN ('R-504','R-505','R-507')
  AND reservation_status = 'active'
  AND final_charge_amount IS NULL;

-- STEP 3: reconcile vehicle.status against active (non-returned) rentals
UPDATE public.vehicles v
SET status = CASE
  WHEN EXISTS (
    SELECT 1 FROM public.rentals r
    WHERE r.vehicle_id = v.id
      AND r.reservation_status = 'active'
      AND r.returned_at IS NULL
  ) THEN 'rented'
  ELSE 'available'
END
WHERE v.status IN ('rented','available');
