-- Admin-only correction helpers. They set the audit reason so the payments
-- audit trigger records WHY the change happened, then perform the change.

CREATE OR REPLACE FUNCTION public.admin_correct_payment_amount(
  _payment_id text,
  _new_amount numeric,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can correct payments';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  PERFORM set_config('app.audit_reason', _reason, true);
  UPDATE public.payments SET amount = _new_amount WHERE id = _payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', _payment_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_payment(
  _payment_id text,
  _reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can delete payments';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  PERFORM set_config('app.audit_reason', _reason, true);
  DELETE FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment % not found', _payment_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_correct_payment_amount(text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment(text, text) TO authenticated;