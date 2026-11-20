create or replace function public.rentals_clear_return_on_reactivate() returns trigger language plpgsql set search_path=public as $$
begin
  if NEW.reservation_status = 'active' and OLD.reservation_status is distinct from 'active' then
    NEW.returned_at := null;
  end if;
  return NEW;
end $$;
create trigger rentals_clear_return_on_reactivate before update on public.rentals for each row execute function public.rentals_clear_return_on_reactivate();