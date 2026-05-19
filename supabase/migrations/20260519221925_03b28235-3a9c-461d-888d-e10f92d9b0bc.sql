
CREATE TABLE public.vendors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  service_type TEXT DEFAULT NULL,
  reference_number TEXT DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read vendors"
ON public.vendors
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins can insert vendors"
ON public.vendors
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update vendors"
ON public.vendors
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete vendors"
ON public.vendors
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Insert the initial vendor list
INSERT INTO public.vendors (name, phone, service_type, reference_number) VALUES
  ('Mechanic Jr', '856-842-6885', 'Mechanic', NULL),
  ('Killswitch', '856-240-7217', 'Mechanic', NULL),
  ('Nelson Autobody', '856-426-0687', 'Body shop', NULL),
  ('Ronnie G', '609-481-9686', 'Mechanic', NULL),
  ('Autozone', '856-237-0081', 'Parts', '11744473');
