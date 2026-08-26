-- 1. Locked base amount on rentals ---------------------------------------
ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS base_amount numeric;

-- Backfill: original base = the first-period charge. The rate columns are
-- never mutated by extension logic, so they still hold the original base.
UPDATE public.rentals
SET base_amount = COALESCE(rate_amount, rate, weekly_rate)
WHERE base_amount IS NULL;

-- Guard: fill base_amount on insert, lock it against later updates.
CREATE OR REPLACE FUNCTION public.rentals_base_amount_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.base_amount IS NULL THEN
      NEW.base_amount := COALESCE(NEW.rate_amount, NEW.rate, NEW.weekly_rate, 0);
    END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: once set, base is immutable. (NULL legacy rows get one backfill.)
  IF OLD.base_amount IS NOT NULL THEN
    NEW.base_amount := OLD.base_amount;
  ELSIF NEW.base_amount IS NULL THEN
    NEW.base_amount := COALESCE(NEW.rate_amount, NEW.rate, NEW.weekly_rate, 0);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rentals_base_amount_guard ON public.rentals;
CREATE TRIGGER rentals_base_amount_guard
BEFORE INSERT OR UPDATE ON public.rentals
FOR EACH ROW EXECUTE FUNCTION public.rentals_base_amount_guard();

-- 2. Paid/pending status on extension records -----------------------------
ALTER TABLE public.rental_extensions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_id text;

ALTER TABLE public.rental_extensions
  DROP CONSTRAINT IF EXISTS rental_extensions_status_check;
ALTER TABLE public.rental_extensions
  ADD CONSTRAINT rental_extensions_status_check
  CHECK (status IN ('pending', 'paid', 'cancelled'));

-- Backfill: extension is paid when its linked payment row cleared.
UPDATE public.rental_extensions re
SET status = 'paid',
    paid_at = COALESCE(p.paid_date::timestamptz, now())
FROM public.payments p
WHERE p.id = re.payment_id
  AND p.status = 'paid'
  AND re.status <> 'paid';

-- Backfill: extension is paid when a paid extension link references it.
UPDATE public.rental_extensions re
SET status = 'paid',
    paid_at = COALESCE(re.paid_at, er.paid_at, now()),
    invoice_id = COALESCE(re.invoice_id, er.stripe_session_id)
FROM public.extension_requests er
WHERE er.rental_extension_id = re.id
  AND er.status = 'paid'
  AND re.status <> 'paid';

-- 3. Keep extension status in sync when money moves -----------------------
CREATE OR REPLACE FUNCTION public.sync_extension_paid_from_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    UPDATE public.rental_extensions
    SET status = 'paid',
        paid_at = COALESCE(paid_at, NEW.paid_date::timestamptz, now())
    WHERE payment_id = NEW.id
      AND status <> 'paid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_sync_extension_paid ON public.payments;
CREATE TRIGGER payments_sync_extension_paid
AFTER INSERT OR UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.sync_extension_paid_from_payment();

CREATE OR REPLACE FUNCTION public.sync_extension_paid_from_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    UPDATE public.rental_extensions
    SET status = 'paid',
        paid_at = COALESCE(paid_at, NEW.paid_at, now()),
        invoice_id = COALESCE(invoice_id, NEW.stripe_session_id)
    WHERE id = NEW.rental_extension_id
      AND status <> 'paid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS extension_requests_sync_paid ON public.extension_requests;
CREATE TRIGGER extension_requests_sync_paid
AFTER INSERT OR UPDATE OF status ON public.extension_requests
FOR EACH ROW EXECUTE FUNCTION public.sync_extension_paid_from_request();