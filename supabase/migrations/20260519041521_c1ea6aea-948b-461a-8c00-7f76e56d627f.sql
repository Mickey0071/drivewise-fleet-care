-- Backfill returned_at from end_date where missing
UPDATE public.rentals
SET returned_at = (end_date::timestamp AT TIME ZONE 'UTC')
WHERE end_date IS NOT NULL AND returned_at IS NULL;

-- Backfill is_return_inspection from job_type
UPDATE public.inspections
SET is_return_inspection = true
WHERE job_type = 'vehicle_return' AND is_return_inspection = false;