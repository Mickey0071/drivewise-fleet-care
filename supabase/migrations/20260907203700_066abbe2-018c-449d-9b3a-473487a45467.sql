revoke execute on function public.has_violations_access(uuid) from public, anon;
grant execute on function public.has_violations_access(uuid) to authenticated, service_role;