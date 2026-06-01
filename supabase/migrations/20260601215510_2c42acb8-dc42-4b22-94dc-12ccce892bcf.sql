ALTER TABLE public.rentals REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.rental_extensions REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.rentals;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.rental_extensions;