UPDATE public.rentals
SET reservation_status = 'active',
    payment_received = true,
    activated_at = COALESCE(activated_at, now()),
    pending_created_at = NULL,
    updated_at = now()
WHERE id = 'R-526'
  AND reservation_status = 'pending';