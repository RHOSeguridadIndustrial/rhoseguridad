-- Publish only after the MFA enrollment/challenge screen and API guards are ready.
create table private.admin_session_activity (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_activity_at timestamptz not null default now()
);
alter table private.admin_session_activity enable row level security;
revoke all on private.admin_session_activity from public,anon,authenticated,service_role;

create or replace function private.current_user_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles where id=(select auth.uid()) and role='admin'
  );
$$;
revoke all on function private.current_user_is_admin() from public,anon;
grant execute on function private.current_user_is_admin() to authenticated;

create or replace function private.admin_session_base_valid()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and (select auth.jwt()->>'aal')='aal2'
    and exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and deactivated_at is null)
    and exists(select 1 from auth.mfa_factors where user_id=(select auth.uid()) and status='verified' and factor_type='totp')
    and exists(select 1 from auth.sessions where id=nullif((select auth.jwt()->>'session_id'),'')::uuid
      and user_id=(select auth.uid()) and aal::text='aal2'
      and created_at>now()-interval '8 hours' and (not_after is null or not_after>now()));
$$;
revoke all on function private.admin_session_base_valid() from public,anon,authenticated,service_role;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and private.admin_session_base_valid()
    and exists(select 1 from private.admin_session_activity
      where session_id=nullif((select auth.jwt()->>'session_id'),'')::uuid
        and user_id=(select auth.uid()) and last_activity_at>now()-interval '15 minutes');
$$;
revoke all on function private.is_admin() from public,anon;
grant execute on function private.is_admin() to authenticated;

create or replace function private.touch_admin_session()
returns boolean language plpgsql security definer set search_path = '' as $$
declare sid uuid; previous timestamptz; proof timestamptz;
begin
  if auth.uid() is null or not private.admin_session_base_valid() then return false; end if;
  sid:=(auth.jwt()->>'session_id')::uuid;
  -- Serialize initialization/refresh for this exact session, including a new row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(sid::text,0));
  select last_activity_at into previous from private.admin_session_activity where session_id=sid for update;
  if previous is not null and previous<=now()-interval '15 minutes' then
    select max(to_timestamp((entry->>'timestamp')::double precision)) into proof
      from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) as entry where entry->>'method'='totp';
    if proof is null or proof<=previous or proof<now()-interval '2 minutes' then return false; end if;
  end if;
  insert into private.admin_session_activity(session_id,user_id,last_activity_at) values(sid,auth.uid(),now())
    on conflict(session_id) do update set last_activity_at=excluded.last_activity_at;
  return true;
end;
$$;
revoke all on function private.touch_admin_session() from public,anon;
grant execute on function private.touch_admin_session() to authenticated;
grant usage on schema private to authenticated;

create or replace function public.admin_session_touch()
returns boolean language sql security invoker set search_path = '' as $$ select private.touch_admin_session(); $$;
create or replace function public.admin_session_authorized()
returns boolean language sql stable security invoker set search_path = '' as $$ select private.is_admin(); $$;
revoke all on function public.admin_session_touch() from public,anon;
revoke all on function public.admin_session_authorized() from public,anon;
grant execute on function public.admin_session_touch(),public.admin_session_authorized() to authenticated;

-- Keep own-profile reads available at AAL1 so an admin can enroll MFA safely.
-- Other admin permissions require live MFA + a non-expired session, even where
-- older permissive policies use a simple role check instead of private.is_admin().
create policy secure_admin_profiles_read on public.profiles as restrictive
  for select to authenticated using(id=(select auth.uid()) or not (select private.current_user_is_admin()) or (select private.is_admin()));
create policy secure_admin_profiles_update on public.profiles as restrictive
  for update to authenticated using(not (select private.current_user_is_admin()) or (select private.is_admin()))
  with check(not (select private.current_user_is_admin()) or (select private.is_admin()));

do $$
declare target text;
begin
  for target in select distinct tablename from pg_catalog.pg_policies where schemaname='public' and tablename<>'profiles' loop
    execute format('create policy secure_admin_session on public.%I as restrictive for all to authenticated using (not (select private.current_user_is_admin()) or (select private.is_admin())) with check (not (select private.current_user_is_admin()) or (select private.is_admin()))',target);
  end loop;
end;
$$;
