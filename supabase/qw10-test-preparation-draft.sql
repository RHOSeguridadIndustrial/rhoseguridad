-- Local review draft only: do not apply to production.
create table qw10_test.preparation_events (
 request_id text not null references qw10_test.requests(id),
 action text not null check(action in ('prepare','dispatch')),
 actor text not null check(length(trim(actor))>0),
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(request_id,action)
);
alter table qw10_test.preparation_events enable row level security;
revoke all on qw10_test.preparation_events from public,anon,authenticated;
grant select,insert on qw10_test.preparation_events to service_role;
create function public.qw10_test_prepare(p_owner text,p_session text,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r qw10_test.requests; result jsonb;
begin
 if p_owner is null or length(trim(p_owner))=0 or p_action is null or p_action not in ('prepare','dispatch') or p_session is null or p_session !~ '^cs_test_[A-Za-z0-9_]+$' then raise exception 'Invalid test action'; end if;
 select * into r from qw10_test.requests where session_id=p_session and owner_id=p_owner and livemode=false for update;
 if not found then raise exception 'Test order not found'; end if;
 if not exists(select 1 from qw10_test.receipts where request_id=r.id and state='paid') or not exists(select 1 from qw10_test.purchase_orders where request_id=r.id) then raise exception 'Paid test order required'; end if;
 if p_action='dispatch' and not exists(select 1 from qw10_test.preparation_events where request_id=r.id and action='prepare') then raise exception 'Preparation required'; end if;
 insert into qw10_test.preparation_events(request_id,action,actor) values(r.id,p_action,p_owner) on conflict(request_id,action) do nothing;
 select jsonb_build_object('environment','test','state',case when exists(select 1 from qw10_test.preparation_events where request_id=r.id and action='dispatch') then 'dispatched' else 'prepared' end,'events',coalesce(jsonb_agg(jsonb_build_object('action',action,'at',recorded_at) order by recorded_at,action),'[]'::jsonb)) into result from qw10_test.preparation_events where request_id=r.id;
 return result;
end;$$;
revoke all on function public.qw10_test_prepare(text,text,text) from public,anon,authenticated;
grant execute on function public.qw10_test_prepare(text,text,text) to service_role;
