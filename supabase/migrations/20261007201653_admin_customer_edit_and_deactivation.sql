-- Deploy before the admin-manage-customer Edge Function and the frontend.
-- No customer rows are changed by this migration.
alter table public.profiles add column if not exists deactivated_at timestamptz;

alter table public.customer_admin_audit drop constraint customer_admin_audit_action_check;
alter table public.customer_admin_audit add constraint customer_admin_audit_action_check
  check (action in ('create_customer','resend_invite','edit_customer','deactivate_customer','reactivate_customer'));

-- Customers can still maintain their contact details, but cannot change login email,
-- ownership, role, status, or revision through the public table API.
revoke update on public.profiles from authenticated;
grant update (full_name, company_name, phone) on public.profiles to authenticated;

create or replace function private.stamp_customer_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function private.stamp_customer_revision() from public, anon, authenticated;
create trigger stamp_customer_revision before update on public.profiles
  for each row execute function private.stamp_customer_revision();

-- Auth access tokens may remain valid until expiry after a ban. The live status
-- check immediately blocks customer operations even with a previously issued JWT.
create or replace function private.customer_account_enabled()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p where p.id = (select auth.uid()) and p.deactivated_at is null
  );
$$;
revoke all on function private.customer_account_enabled() from public, anon;
grant execute on function private.customer_account_enabled() to authenticated;
create policy customer_active_profile_update on public.profiles as restrictive
  for update to authenticated
  using ((select private.customer_account_enabled()))
  with check ((select private.customer_account_enabled()));

do $$
declare target text;
begin
  foreach target in array array['loyalty_customer_details','loyalty_cards','loyalty_transactions',
    'loyalty_transaction_items','loyalty_points_ledger','loyalty_redemptions'] loop
    execute format('create policy customer_account_enabled on public.%I as restrictive for all to authenticated using ((select private.customer_account_enabled())) with check ((select private.customer_account_enabled()))', target);
  end loop;
end;
$$;

-- app_metadata is server-controlled. A unique operation comes exclusively from
-- the authenticated admin Edge Function. Auth, profile, and audit commit together.
create or replace function private.apply_customer_admin_operation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  op jsonb := new.raw_app_meta_data -> 'rho_customer_admin_operation';
  actor uuid;
  target public.profiles%rowtype;
  changed public.profiles%rowtype;
  action_name text;
  values_json jsonb;
  auth_email text;
  auth_ban timestamptz;
begin
  if op is null or op is not distinct from old.raw_app_meta_data -> 'rho_customer_admin_operation' then
    return new;
  end if;
  if jsonb_typeof(op) <> 'object' or nullif(op->>'id','') is null then
    raise exception 'Invalid customer operation';
  end if;
  actor := (op->>'actor_id')::uuid;
  -- Auth admin API calls have no auth.uid(). If a user identity is present it
  -- must be the exact authorized administrator recorded by the server.
  if auth.uid() is not null and auth.uid() is distinct from actor then
    raise exception 'Invalid operation actor';
  end if;
  if actor is null or actor = new.id or not exists (
    select 1 from public.profiles where id = actor and role = 'admin' and deactivated_at is null
  ) then raise exception 'Administrator required'; end if;
  select * into target from public.profiles where id = new.id for update;
  if not found or target.role <> 'customer' then raise exception 'Protected account'; end if;
  if target.updated_at is distinct from (op->>'expected_updated_at')::timestamptz then
    raise exception 'Customer changed; reload before saving';
  end if;
  select email, banned_until into auth_email, auth_ban from auth.users where id = new.id;
  action_name := op->>'action';
  if action_name = 'edit' then
    values_json := op->'fields';
    if jsonb_typeof(values_json) is distinct from 'object'
      or coalesce(length(btrim(values_json->>'full_name')),0) not between 3 and 160
      or coalesce(length(values_json->>'company_name'),0) > 160
      or coalesce(length(values_json->>'phone'),0) > 40
      or lower(auth_email) is distinct from lower(values_json->>'email') then
      raise exception 'Invalid customer fields';
    end if;
    update public.profiles set email = auth_email,
      full_name = values_json->>'full_name', company_name = nullif(values_json->>'company_name',''),
      phone = nullif(values_json->>'phone','') where id = new.id returning * into changed;
  elsif action_name = 'deactivate' then
    if target.deactivated_at is not null or auth_ban is null or auth_ban <= now()
      or coalesce(length(btrim(op->>'reason')),0) not between 3 and 300 then
      raise exception 'Invalid deactivation';
    end if;
    update public.profiles set deactivated_at = clock_timestamp() where id = new.id returning * into changed;
  elsif action_name = 'reactivate' then
    if target.deactivated_at is null or (auth_ban is not null and auth_ban > now()) then
      raise exception 'Invalid reactivation';
    end if;
    update public.profiles set deactivated_at = null where id = new.id returning * into changed;
  else raise exception 'Unsupported customer action';
  end if;
  insert into public.customer_admin_audit(admin_user_id,customer_user_id,action,customer_email,metadata)
    values (actor,new.id,action_name || '_customer',changed.email,
      jsonb_build_object('operation_id',op->>'id','reason',op->>'reason',
        'before',jsonb_build_object('email',target.email,'full_name',target.full_name,'company_name',target.company_name,'phone',target.phone,'deactivated_at',target.deactivated_at),
        'after',jsonb_build_object('email',changed.email,'full_name',changed.full_name,'company_name',changed.company_name,'phone',changed.phone,'deactivated_at',changed.deactivated_at)));
  return new;
end;
$$;
revoke all on function private.apply_customer_admin_operation() from public, anon, authenticated, service_role;
create constraint trigger apply_customer_admin_operation after update on auth.users
  deferrable initially deferred
  for each row when ((old.raw_app_meta_data -> 'rho_customer_admin_operation') is distinct from (new.raw_app_meta_data -> 'rho_customer_admin_operation'))
  execute function private.apply_customer_admin_operation();
