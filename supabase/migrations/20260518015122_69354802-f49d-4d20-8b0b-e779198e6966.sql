-- Allow runner (staff) role to operate rentals, inspections, vehicles, maintenance
-- without exposing finance/payroll/insurance data.

-- RENTALS
CREATE POLICY "Runners insert rentals" ON public.rentals
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Runners update rentals" ON public.rentals
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));

-- INSPECTIONS
CREATE POLICY "Runners insert inspections" ON public.inspections
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Runners update inspections" ON public.inspections
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));

-- VEHICLES (status, mileage, photos — full update OK for runners; no DELETE)
CREATE POLICY "Runners update vehicles" ON public.vehicles
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));

-- MAINTENANCE (so runners can log damage from a return)
CREATE POLICY "Runners insert maintenance" ON public.maintenance
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Runners update maintenance" ON public.maintenance
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));

-- RENTAL EXTENSIONS
CREATE POLICY "Runners insert extensions" ON public.rental_extensions
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Runners update extensions" ON public.rental_extensions
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));

-- VEHICLE PHOTOS
CREATE POLICY "Runners insert vehicle_photos" ON public.vehicle_photos
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Runners update vehicle_photos" ON public.vehicle_photos
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Runners delete vehicle_photos" ON public.vehicle_photos
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));

-- VIOLATIONS (runners can log)
CREATE POLICY "Runners insert violations" ON public.violations
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Runners update violations" ON public.violations
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));

-- DRIVERS (runners need to add/update renter contact info)
CREATE POLICY "Runners insert drivers" ON public.drivers
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Runners update drivers" ON public.drivers
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));