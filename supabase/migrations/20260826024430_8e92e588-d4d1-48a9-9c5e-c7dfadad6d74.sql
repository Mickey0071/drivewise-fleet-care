-- 1. rentals.base_amount: original first-period charge, locked after creation
ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS base_amount numeric;

-- Backfill: best available original base = explicit rate_amount, else rate, else weekly_rate
UPDATE public.rentals
SET base_amount = COALESCE(rate_amount, rate, weekly_rate)
WHERE base_amount IS NULL;

-- Lock: once set, base_amount cannot be changed by later updates
CREATE OR REPLACE FUNCTION public.lock_rental_base_amount()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.base_amount IS NOT NULL AND NEW.base_amount IS DISTINCT FROM OLD.base_amount THEN
    NEW.base_amount := OLD.base_amount;
  END IF;
  IF NEW.base_amount IS NULL THEN
    NEW.base_amount := COALESCE(NEW.rate_amount, NEW.rate, NEW.weekly_rate);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rentals_lock_base_amount ON public.rentals;
CREATE TRIGGER rentals_lock_base_amount
  BEFORE INSERT OR UPDATE ON public.rentals
  FOR EACH ROW EXECUTE FUNCTION public.lock_rental_base_amount();

-- 2. rental_extensions: paid/pending status + payment provenance
ALTER TABLE public.rental_extensions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.rental_extensions ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE public.rental_extensions ADD COLUMN IF NOT EXISTS invoice_id text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rental_extensions_status_check') THEN
    ALTER TABLE public.rental_extensions
      ADD CONSTRAINT rental_extensions_status_check CHECK (status IN ('pending','paid','cancelled'));
  END IF;
END $$;

-- Backfill: extensions with a linked paid payment row are paid
UPDATE public.rental_extensions re
SET status = 'paid',
    paid_at = COALESCE(re.paid_at, p.paid_date::timestamptz, now())
FROM public.payments p
WHERE p.id = re.payment_id
  AND p.status = 'paid'
  AND re.status <> 'paid';

-- Backfill: extensions referenced by a paid extension request are paid
UPDATE public.rental_extensions re
SET status = 'paid',
    paid_at = COALESCE(re.paid_at, er.paid_at, now()),
    invoice_id = COALESCE(re.invoice_id, er.stripe_session_id)
FROM public.extension_requests er
WHERE er.rental_extension_id = re.id
  AND er.status = 'paid'
  AND re.status <> 'paid';

-- 3. Sync triggers: keep extension status aligned with money movement
CREATE OR REPLACE FUNCTION public.sync_extension_paid_from_payment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    UPDATE public.rental_extensions
    SET status = 'paid', paid_at = COALESCE(paid_at, NEW.paid_date::timestamptz, now())
    WHERE payment_id = NEW.id AND status <> 'paid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_extension_paid_from_payment ON public.payments;
CREATE TRIGGER trg_sync_extension_paid_from_payment
  AFTER UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.sync_extension_paid_from_payment();

CREATE OR REPLACE FUNCTION public.sync_extension_paid_from_request()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') AND NEW.rental_extension_id IS NOT NULL THEN
    UPDATE public.rental_extensions
    SET status = 'paid',
        paid_at = COALESCE(paid_at, NEW.paid_at, now()),
        invoice_id = COALESCE(invoice_id, NEW.stripe_session_id)
    WHERE id = NEW.rental_extension_id AND status <> 'paid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_extension_paid_from_request ON public.extension_requests;
CREATE TRIGGER trg_sync_extension_paid_from_request
  AFTER UPDATE OF status ON public.extension_requests
  FOR EACH ROW EXECUTE FUNCTION public.sync_extension_paid_from_request();