create or replace function public.is_staff(_uid uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.user_roles where user_id=_uid and role in ('admin','va','runner'))
$$;

drop policy "Authenticated read vehicles" on public.vehicles;
create policy "Staff or renters read vehicles" on public.vehicles for select to authenticated
using (public.is_staff(auth.uid()) or exists(select 1 from public.rentals r where r.vehicle_id=vehicles.id and r.driver_id=public.current_driver_id()));

drop policy "Authenticated read vehicle_photos" on public.vehicle_photos;
create policy "Staff or renters read vehicle_photos" on public.vehicle_photos for select to authenticated
using (public.is_staff(auth.uid()) or exists(select 1 from public.rentals r where r.vehicle_id=vehicle_photos.vehicle_id and r.driver_id=public.current_driver_id()));

drop policy "Authenticated can delete service types" on public.service_types;
drop policy "Authenticated can update service types" on public.service_types;
drop policy "Authenticated can insert service types" on public.service_types;
drop policy "Authenticated can view service types" on public.service_types;
create policy "Staff view service types" on public.service_types for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin/VA manage service types" on public.service_types for all to authenticated using (public.has_violations_access(auth.uid())) with check (public.has_violations_access(auth.uid()));

drop policy "Authenticated can view suppliers" on public.parts_suppliers;
create policy "Admin/VA view suppliers" on public.parts_suppliers for select to authenticated using (public.has_violations_access(auth.uid()));

drop policy "Authenticated can insert import logs" on public.import_logs;
drop policy "Authenticated can view import logs" on public.import_logs;
create policy "Admin/VA manage import logs" on public.import_logs for all to authenticated using (public.has_violations_access(auth.uid())) with check (public.has_violations_access(auth.uid()));

drop policy "Allow authenticated full access" on public.repair_types;
create policy "Staff view repair types" on public.repair_types for select to authenticated using (public.is_staff(auth.uid()));
create policy "Admin/VA manage repair types" on public.repair_types for all to authenticated using (public.has_violations_access(auth.uid())) with check (public.has_violations_access(auth.uid()));

drop policy "Staff can manage checklist items" on public.checklist_items;
create policy "Staff manage checklist items" on public.checklist_items for all to authenticated using (public.is_staff(auth.uid())) with check (public.is_staff(auth.uid()));

drop policy "Authenticated can delete mechanics" on public.mechanics;
drop policy "Authenticated can insert mechanics" on public.mechanics;
drop policy "Authenticated can read mechanics" on public.mechanics;
drop policy "Authenticated can update mechanics" on public.mechanics;
create policy "Admin/VA manage mechanics" on public.mechanics for all to authenticated using (public.has_violations_access(auth.uid())) with check (public.has_violations_access(auth.uid()));

drop policy "Authenticated can read waitlist uploads" on storage.objects;
create policy "Admin/VA read waitlist uploads" on storage.objects for select to authenticated using (bucket_id='waitlist-uploads' and public.has_violations_access(auth.uid()));

drop policy "Authenticated manage legacy agreements" on storage.objects;
create policy "Admin/VA manage legacy agreements" on storage.objects for all to authenticated using (bucket_id='legacy-agreements' and public.has_violations_access(auth.uid())) with check (bucket_id='legacy-agreements' and public.has_violations_access(auth.uid()));