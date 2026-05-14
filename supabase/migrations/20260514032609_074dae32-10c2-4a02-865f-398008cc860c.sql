ALTER TABLE public.reminder_log DROP CONSTRAINT reminder_log_reminder_type_check;
ALTER TABLE public.reminder_log ADD CONSTRAINT reminder_log_reminder_type_check
  CHECK (reminder_type IN ('payment_due', 'rental_return', 'admin_past_due'));