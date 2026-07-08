ALTER TABLE public.violations
  ADD CONSTRAINT violations_rental_id_fkey
  FOREIGN KEY (rental_id) REFERENCES public.rentals(id) ON DELETE SET NULL;