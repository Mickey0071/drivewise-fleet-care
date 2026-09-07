create or replace function public.has_violations_access(_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles
    where user_id = _user_id and role in ('admin'::app_role, 'va'::app_role)
  )
$$;

grant execute on function public.has_violations_access(uuid) to authenticated;

-- violations
drop policy if exists "Violations staff manage violations" on public.violations;
create policy "Violations staff manage violations" on public.violations
  for all to authenticated
  using (public.has_violations_access(auth.uid()))
  with check (public.has_violations_access(auth.uid()));
grant select, insert, update, delete on public.violations to authenticated;

-- violation_matches
drop policy if exists "Violations staff manage violation matches" on public.violation_matches;
create policy "Violations staff manage violation matches" on public.violation_matches
  for all to authenticated
  using (public.has_violations_access(auth.uid()))
  with check (public.has_violations_access(auth.uid()));
grant select, insert, update, delete on public.violation_matches to authenticated;

-- violation_status_history
drop policy if exists "Violations staff manage violation status history" on public.violation_status_history;
create policy "Violations staff manage violation status history" on public.violation_status_history
  for all to authenticated
  using (public.has_violations_access(auth.uid()))
  with check (public.has_violations_access(auth.uid()));
grant select, insert, update, delete on public.violation_status_history to authenticated;

-- ezpass batches + items
drop policy if exists "Violations staff manage ezpass batches" on public.ezpass_batches;
create policy "Violations staff manage ezpass batches" on public.ezpass_batches
  for all to authenticated
  using (public.has_violations_access(auth.uid()))
  with check (public.has_violations_access(auth.uid()));
grant select, insert, update, delete on public.ezpass_batches to authenticated;

drop policy if exists "Violations staff manage ezpass items" on public.ezpass_batch_items;
create policy "Violations staff manage ezpass items" on public.ezpass_batch_items
  for all to authenticated
  using (public.has_violations_access(auth.uid()))
  with check (public.has_violations_access(auth.uid()));
grant select, insert, update, delete on public.ezpass_batch_items to authenticated;

-- dispute packets
drop policy if exists "Violations staff manage dispute packets" on public.dispute_packets;
create policy "Violations staff manage dispute packets" on public.dispute_packets
  for all to authenticated
  using (public.has_violations_access(auth.uid()))
  with check (public.has_violations_access(auth.uid()));
grant select, insert, update, delete on public.dispute_packets to authenticated;

-- read access needed to match a violation to a renter
drop policy if exists "Violations staff read rentals" on public.rentals;
create policy "Violations staff read rentals" on public.rentals
  for select to authenticated
  using (public.has_violations_access(auth.uid()));
grant select on public.rentals to authenticated;

drop policy if exists "Violations staff read legacy rentals" on public.legacy_rentals;
create policy "Violations staff read legacy rentals" on public.legacy_rentals
  for select to authenticated
  using (public.has_violations_access(auth.uid()));
grant select on public.legacy_rentals to authenticated;

drop policy if exists "Violations staff read drivers" on public.drivers;
create policy "Violations staff read drivers" on public.drivers
  for select to authenticated
  using (public.has_violations_access(auth.uid()));
grant select on public.drivers to authenticated;