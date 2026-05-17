
-- ============ STAFF: admin-only read + write ============
DROP POLICY IF EXISTS "Authenticated read staff" ON public.staff;
DROP POLICY IF EXISTS "Authenticated write staff" ON public.staff;
CREATE POLICY "Admins read staff" ON public.staff FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert staff" ON public.staff FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update staff" ON public.staff FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete staff" ON public.staff FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ PAYROLL: admin-only read + write ============
DROP POLICY IF EXISTS "Authenticated read payroll_runs" ON public.payroll_runs;
DROP POLICY IF EXISTS "Authenticated write payroll_runs" ON public.payroll_runs;
CREATE POLICY "Admins read payroll_runs" ON public.payroll_runs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert payroll_runs" ON public.payroll_runs FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update payroll_runs" ON public.payroll_runs FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete payroll_runs" ON public.payroll_runs FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated read payroll_lines" ON public.payroll_lines;
DROP POLICY IF EXISTS "Authenticated write payroll_lines" ON public.payroll_lines;
CREATE POLICY "Admins read payroll_lines" ON public.payroll_lines FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert payroll_lines" ON public.payroll_lines FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update payroll_lines" ON public.payroll_lines FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete payroll_lines" ON public.payroll_lines FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ INSURANCE: admin-only read + write ============
DROP POLICY IF EXISTS "Authenticated read insurance_entries" ON public.insurance_entries;
DROP POLICY IF EXISTS "Authenticated write insurance_entries" ON public.insurance_entries;
CREATE POLICY "Admins read insurance_entries" ON public.insurance_entries FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert insurance_entries" ON public.insurance_entries FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update insurance_entries" ON public.insurance_entries FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete insurance_entries" ON public.insurance_entries FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated read icl" ON public.insurance_claim_checklist;
DROP POLICY IF EXISTS "Authenticated write icl" ON public.insurance_claim_checklist;
CREATE POLICY "Admins read icl" ON public.insurance_claim_checklist FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert icl" ON public.insurance_claim_checklist FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update icl" ON public.insurance_claim_checklist FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete icl" ON public.insurance_claim_checklist FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ REMINDER LOG: admin-only read ============
DROP POLICY IF EXISTS "Authenticated read reminder_log" ON public.reminder_log;
CREATE POLICY "Admins read reminder_log" ON public.reminder_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ RENTAL SHARE LINKS: admin-only read + write ============
DROP POLICY IF EXISTS "Authenticated read share links" ON public.rental_share_links;
DROP POLICY IF EXISTS "Authenticated write share links" ON public.rental_share_links;
CREATE POLICY "Admins read share links" ON public.rental_share_links FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert share links" ON public.rental_share_links FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update share links" ON public.rental_share_links FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete share links" ON public.rental_share_links FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ DRIVERS: authenticated read, admin write ============
DROP POLICY IF EXISTS "Authenticated read drivers" ON public.drivers;
DROP POLICY IF EXISTS "Authenticated write drivers" ON public.drivers;
CREATE POLICY "Authenticated read drivers" ON public.drivers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert drivers" ON public.drivers FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update drivers" ON public.drivers FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete drivers" ON public.drivers FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ VEHICLES: authenticated read, admin write ============
DROP POLICY IF EXISTS "Authenticated read vehicles" ON public.vehicles;
DROP POLICY IF EXISTS "Authenticated write vehicles" ON public.vehicles;
CREATE POLICY "Authenticated read vehicles" ON public.vehicles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert vehicles" ON public.vehicles FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update vehicles" ON public.vehicles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete vehicles" ON public.vehicles FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated read vehicle_photos" ON public.vehicle_photos;
DROP POLICY IF EXISTS "Authenticated write vehicle_photos" ON public.vehicle_photos;
CREATE POLICY "Authenticated read vehicle_photos" ON public.vehicle_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert vehicle_photos" ON public.vehicle_photos FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update vehicle_photos" ON public.vehicle_photos FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete vehicle_photos" ON public.vehicle_photos FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ RENTALS: authenticated read, admin write ============
DROP POLICY IF EXISTS "Authenticated read rentals" ON public.rentals;
DROP POLICY IF EXISTS "Authenticated write rentals" ON public.rentals;
CREATE POLICY "Authenticated read rentals" ON public.rentals FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert rentals" ON public.rentals FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update rentals" ON public.rentals FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete rentals" ON public.rentals FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated read extensions" ON public.rental_extensions;
DROP POLICY IF EXISTS "Authenticated write extensions" ON public.rental_extensions;
CREATE POLICY "Authenticated read extensions" ON public.rental_extensions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert extensions" ON public.rental_extensions FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update extensions" ON public.rental_extensions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete extensions" ON public.rental_extensions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ PAYMENTS, VIOLATIONS, MAINTENANCE, INSPECTIONS: authenticated read, admin write ============
DROP POLICY IF EXISTS "Authenticated read payments" ON public.payments;
DROP POLICY IF EXISTS "Authenticated write payments" ON public.payments;
CREATE POLICY "Authenticated read payments" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update payments" ON public.payments FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete payments" ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated read violations" ON public.violations;
DROP POLICY IF EXISTS "Authenticated write violations" ON public.violations;
CREATE POLICY "Authenticated read violations" ON public.violations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert violations" ON public.violations FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update violations" ON public.violations FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete violations" ON public.violations FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated read maintenance" ON public.maintenance;
DROP POLICY IF EXISTS "Authenticated write maintenance" ON public.maintenance;
CREATE POLICY "Authenticated read maintenance" ON public.maintenance FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert maintenance" ON public.maintenance FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update maintenance" ON public.maintenance FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete maintenance" ON public.maintenance FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated read inspections" ON public.inspections;
DROP POLICY IF EXISTS "Authenticated write inspections" ON public.inspections;
CREATE POLICY "Authenticated read inspections" ON public.inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins insert inspections" ON public.inspections FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins update inspections" ON public.inspections FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins delete inspections" ON public.inspections FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
