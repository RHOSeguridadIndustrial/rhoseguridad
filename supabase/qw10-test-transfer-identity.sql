-- Supabase owns auth: application migration roles cannot grant its USAGE.
-- Resolve the verified actor through a narrow private definer, without table access grants.
create function private.qw10_transfer_actor()
returns uuid language plpgsql stable security definer set search_path='' as $$
begin
 if private.is_admin() is distinct from true then
  raise exception 'Solo administradores' using errcode='42501';
 end if;
 return auth.uid();
end$$;
revoke all on function private.qw10_transfer_actor() from public,anon,authenticated,service_role;
grant execute on function private.qw10_transfer_actor() to qw10_transfer_executor;
grant create on schema private to qw10_transfer_executor;
set local role qw10_transfer_executor;
do $$declare definition text;begin
 select pg_get_functiondef('private.qw10_test_transfer(text,text,text,bigint)'::regprocedure) into definition;
 if position('auth.uid()' in definition)=0 then raise exception 'Expected transfer identity calls';end if;
 definition:=replace(definition,'auth.uid() is null or private.is_admin() is distinct from true','auth.uid() is null');
 execute replace(definition,'auth.uid()','private.qw10_transfer_actor()');
end$$;
reset role;
revoke create on schema private from qw10_transfer_executor;
