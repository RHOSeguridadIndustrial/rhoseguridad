-- The website owns campaign intent. The existing hourly worker reads this gate
-- before work and again before each supplier contact. No mail credentials live here.
create table private.procurement_control (
  singleton boolean primary key default true check(singleton),
  mode text not null default 'paused' check(mode in ('active','paused','off')),
  revision bigint not null default 1,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null,
  last_checked_at timestamptz,
  last_checked_revision bigint,
  last_worker_state text,
  run_id uuid,
  lease_until timestamptz,
  last_finished_at timestamptz,
  last_outcome text
);
create table private.procurement_control_events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id) on delete set null,
  previous_mode text,
  mode text not null,
  revision bigint not null
);
alter table private.procurement_control enable row level security;
alter table private.procurement_control_events enable row level security;
revoke all on private.procurement_control, private.procurement_control_events from public,anon,authenticated,service_role;
revoke all on sequence private.procurement_control_events_id_seq from public,anon,authenticated,service_role;
insert into private.procurement_control(singleton) values(true);
insert into private.procurement_control_events(mode,revision) values('paused',1);

create function private.procurement_contact_open(p_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select extract(isodow from p_at at time zone 'America/Mexico_City') between 1 and 5
    and (p_at at time zone 'America/Mexico_City')::time >= time '09:00'
    and (p_at at time zone 'America/Mexico_City')::time < time '18:00';
$$;
revoke all on function private.procurement_contact_open(timestamptz) from public,anon,authenticated,service_role;

create function private.procurement_snapshot()
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'mode',c.mode,'revision',c.revision,'changed_at',c.changed_at,
    'server_now',now(),'contact_window_open',private.procurement_contact_open(now()),
    'last_checked_at',c.last_checked_at,'last_checked_revision',c.last_checked_revision,
    'last_worker_state',c.last_worker_state,'last_finished_at',c.last_finished_at,
    'last_outcome',c.last_outcome,
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (
      select id,created_at,previous_mode,mode,revision,actor_id is not null as by_admin
      from private.procurement_control_events order by id desc limit 10
    ) e),'[]'::jsonb)
  ) from private.procurement_control c where singleton;
$$;
revoke all on function private.procurement_snapshot() from public,anon,authenticated,service_role;

create function private.admin_procurement_get()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce(private.is_admin(),false) then
    raise exception 'Administrator with a verified active session required' using errcode='42501';
  end if;
  return private.procurement_snapshot();
end;
$$;
create function private.admin_procurement_set(p_mode text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c private.procurement_control%rowtype;
begin
  if not coalesce(private.is_admin(),false) then
    raise exception 'Administrator with a verified active session required' using errcode='42501';
  end if;
  if p_mode is null or p_mode not in ('active','paused','off') then
    raise exception 'Invalid campaign mode' using errcode='22023';
  end if;
  select * into strict c from private.procurement_control where singleton for update;
  if p_expected_revision is distinct from c.revision then
    raise exception 'Campaign changed; reload before saving' using errcode='40001';
  end if;
  if c.mode<>p_mode then
    update private.procurement_control set mode=p_mode,revision=c.revision+1,
      changed_at=now(),changed_by=auth.uid(),run_id=null,lease_until=null where singleton;
    insert into private.procurement_control_events(actor_id,previous_mode,mode,revision)
      values(auth.uid(),c.mode,p_mode,c.revision+1);
  end if;
  return private.procurement_snapshot();
end;
$$;
revoke all on function private.admin_procurement_get(),private.admin_procurement_set(text,bigint) from public,anon,authenticated,service_role;
grant execute on function private.admin_procurement_get(),private.admin_procurement_set(text,bigint) to authenticated;

create function public.admin_procurement_get()
returns jsonb language sql set search_path = '' as $$ select private.admin_procurement_get(); $$;
create function public.admin_procurement_set(p_mode text,p_expected_revision bigint)
returns jsonb language sql set search_path = '' as $$ select private.admin_procurement_set(p_mode,p_expected_revision); $$;
revoke all on function public.admin_procurement_get(),public.admin_procurement_set(text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.admin_procurement_get(),public.admin_procurement_set(text,bigint) to authenticated;

-- Only the trusted automation's connected SQL tool may call these private functions.
-- A revision change invalidates every previous run, even after pause -> resume.
create function private.procurement_runner_check(p_run_id uuid,p_revision bigint default null)
returns jsonb language plpgsql set search_path = '' as $$
declare c private.procurement_control%rowtype; permitted boolean:=false; reason text; at_time timestamptz:=clock_timestamp();
begin
  if p_run_id is null then raise exception 'Run ID required'; end if;
  select * into strict c from private.procurement_control where singleton for update;
  if c.mode<>'active' then reason:=c.mode;
  elsif p_revision is not null and (p_revision<>c.revision or c.run_id is distinct from p_run_id) then reason:='superseded';
  elsif c.run_id is not null and c.run_id<>p_run_id and c.lease_until>at_time then reason:='busy';
  else permitted:=true;reason:='ready'; end if;
  update private.procurement_control set
    last_checked_at=at_time,last_checked_revision=c.revision,last_worker_state=reason,
    run_id=case when permitted then p_run_id else run_id end,
    lease_until=case when permitted then at_time+interval '20 minutes' else lease_until end
    where singleton;
  return jsonb_build_object('run_id',p_run_id,'revision',c.revision,'mode',c.mode,
    'allow_work',permitted,'allow_contact',permitted and private.procurement_contact_open(at_time),
    'reason',reason,'checked_at',at_time,'timezone','America/Mexico_City');
end;
$$;
create function private.procurement_runner_finish(p_run_id uuid,p_revision bigint,p_outcome text)
returns boolean language plpgsql set search_path = '' as $$
begin
  if p_outcome is null or p_outcome not in ('completed','blocked','error','stopped') then raise exception 'Invalid outcome'; end if;
  update private.procurement_control set run_id=null,lease_until=null,
    last_finished_at=clock_timestamp(),last_outcome=p_outcome
    where singleton and run_id=p_run_id and revision=p_revision;
  return found;
end;
$$;
revoke all on function private.procurement_runner_check(uuid,bigint),private.procurement_runner_finish(uuid,bigint,text)
  from public,anon,authenticated,service_role;
