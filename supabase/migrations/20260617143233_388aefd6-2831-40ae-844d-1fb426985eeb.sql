-- Payment audit log: captures every future insert, edit, and delete on payments
CREATE TABLE public.payment_audit_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  payment_id text NOT NULL,
  rental_id text,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  before_value jsonb,
  after_value jsonb,
  reason text,
  actor uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_payment_audit_payment ON public.payment_audit_log(payment_id);
CREATE INDEX idx_payment_audit_rental ON public.payment_audit_log(rental_id);
CREATE INDEX idx_payment_audit_created ON public.payment_audit_log(created_at);

GRANT SELECT ON public.payment_audit_log TO authenticated;
GRANT ALL ON public.payment_audit_log TO service_role;

ALTER TABLE public.payment_audit_log ENABLE ROW LEVEL SECURITY;

-- Only admins may read the audit trail. Rows are written by a SECURITY DEFINER
-- trigger (bypasses RLS), so no INSERT policy is needed. No UPDATE/DELETE policy
-- means the log is append-only and immutable from the app.
CREATE POLICY "Admins read payment audit log"
ON public.payment_audit_log FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Trigger function: records before/after snapshots plus an optional reason set by
-- the caller via SET LOCAL app.audit_reason, and the acting user (auth.uid()).
CREATE OR REPLACE FUNCTION public.log_payment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reason text := NULLIF(current_setting('app.audit_reason', true), '');
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.payment_audit_log(payment_id, rental_id, action, before_value, after_value, reason, actor)
    VALUES (NEW.id, NEW.rental_id, 'insert', NULL, to_jsonb(NEW), v_reason, v_actor);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.payment_audit_log(payment_id, rental_id, action, before_value, after_value, reason, actor)
    VALUES (NEW.id, NEW.rental_id, 'update', to_jsonb(OLD), to_jsonb(NEW), v_reason, v_actor);
    RETURN NEW;
  ELSE
    INSERT INTO public.payment_audit_log(payment_id, rental_id, action, before_value, after_value, reason, actor)
    VALUES (OLD.id, OLD.rental_id, 'delete', to_jsonb(OLD), NULL, v_reason, v_actor);
    RETURN OLD;
  END IF;
END;
$$;

CREATE TRIGGER trg_payment_audit
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.log_payment_change();