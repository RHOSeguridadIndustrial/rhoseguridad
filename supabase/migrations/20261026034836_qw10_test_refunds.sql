-- Signed sandbox refund evidence. No payment initiation or inventory permissions.
create table qw10_test.refund_events (
 event_id text primary key check(event_id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
 refund_id text not null check(refund_id ~ '^re_[A-Za-z0-9_]{1,250}$'),
 payment_intent_id text not null check(payment_intent_id ~ '^pi_[A-Za-z0-9_]{1,250}$'),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=9007199254740991),
 currency text not null check(currency ~ '^[a-z]{3}$'),
 status text not null check(status in ('pending','requires_action','succeeded','failed','canceled')),
 event_type text not null check(event_type in ('refund.created','refund.updated','refund.failed')),
 event_created bigint not null check(event_created>=1577836800),
 livemode boolean not null check(livemode=false),
 recorded_at timestamptz not null default clock_timestamp()
);
create index refund_events_payment_latest on qw10_test.refund_events(payment_intent_id,refund_id,event_created desc);
alter table qw10_test.refund_events enable row level security;
revoke all on qw10_test.refund_events from public,anon,authenticated,service_role;
create role qw10_refund_recorder nologin noinherit nobypassrls;
grant qw10_refund_recorder to current_user with inherit false,set true;
grant usage on schema qw10_test to qw10_refund_recorder;
grant select,insert on qw10_test.refund_events to qw10_refund_recorder;
create policy refund_recorder_read on qw10_test.refund_events for select to qw10_refund_recorder using(true);
create policy refund_recorder_insert on qw10_test.refund_events for insert to qw10_refund_recorder with check(true);

create function qw10_test.record_refund(p_event text,p_refund text,p_payment text,p_amount bigint,p_currency text,p_status text,p_type text,p_created bigint,p_live boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old qw10_test.refund_events; inserted text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Fresh transaction required';end if;
 if p_live is distinct from false or p_event is null or p_refund is null or p_payment is null or p_amount is null or p_currency is null or p_status is null or p_type is null or p_created is null
  or p_created>extract(epoch from clock_timestamp())+300 or (p_type='refund.failed' and p_status<>'failed') then raise exception 'Invalid test refund';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('qw10-refund:'||p_refund,0));
 if exists(select 1 from qw10_test.refund_events where refund_id=p_refund and
  (payment_intent_id is distinct from p_payment or amount_cents is distinct from p_amount or currency is distinct from p_currency)) then raise exception 'Refund binding conflict';end if;
 insert into qw10_test.refund_events(event_id,refund_id,payment_intent_id,amount_cents,currency,status,event_type,event_created,livemode)
 values(p_event,p_refund,p_payment,p_amount,p_currency,p_status,p_type,p_created,p_live)
 on conflict(event_id) do nothing returning event_id into inserted;
 if inserted is null then
  select * into old from qw10_test.refund_events where event_id=p_event;
  if old.refund_id is distinct from p_refund or old.payment_intent_id is distinct from p_payment or old.amount_cents is distinct from p_amount or old.currency is distinct from p_currency or old.status is distinct from p_status or old.event_type is distinct from p_type or old.event_created is distinct from p_created then raise exception 'Refund event conflict';end if;
 end if;
 return jsonb_build_object('status','refund_recorded','repeated',inserted is null);
end$$;
revoke all on function qw10_test.record_refund(text,text,text,bigint,text,text,text,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function qw10_test.record_refund(text,text,text,bigint,text,text,text,bigint,boolean) to service_role;
grant create on schema qw10_test to qw10_refund_recorder;
alter function qw10_test.record_refund(text,text,text,bigint,text,text,text,bigint,boolean) owner to qw10_refund_recorder;
revoke create on schema qw10_test from qw10_refund_recorder;
create function public.qw10_test_record_refund(p_event text,p_refund text,p_payment text,p_amount bigint,p_currency text,p_status text,p_type text,p_created bigint,p_live boolean)
returns jsonb language sql security invoker set search_path='' as $$
 select qw10_test.record_refund(p_event,p_refund,p_payment,p_amount,p_currency,p_status,p_type,p_created,p_live)
$$;
revoke all on function public.qw10_test_record_refund(text,text,text,bigint,text,text,text,bigint,boolean) from public,anon,authenticated,service_role;
grant execute on function public.qw10_test_record_refund(text,text,text,bigint,text,text,text,bigint,boolean) to service_role;

-- Event time determines the projection, never arrival order. Equal-second
-- ambiguity remains unresolved: a non-success status wins over succeeded.
-- Evidence may arrive before the original checkout receipt without being lost.
create function qw10_test.refund_snapshot(p_request text,p_payment text,p_amount bigint)
returns jsonb language sql stable security invoker set search_path='' as $$
 with latest as (
  select distinct on (refund_id) refund_id,amount_cents,currency,status,event_id,event_created,recorded_at
  from qw10_test.refund_events where payment_intent_id=p_payment
  order by refund_id,event_created desc,case status when 'failed' then 5 when 'canceled' then 4 when 'requires_action' then 3 when 'pending' then 2 else 1 end desc,event_id
 ), totals as (
  select count(*) n,coalesce(bool_and(status='succeeded' and amount_cents=p_amount and currency='mxn'),false) full_success from latest
 )
 select jsonb_build_object('state',case when n=1 and full_success
   and not exists(select 1 from qw10_test.purchase_orders where request_id=p_request)
   and not exists(select 1 from qw10_test.movements where request_id=p_request)
   then 'refunded' else 'unresolved' end,
  'refunds',coalesce((select jsonb_agg(to_jsonb(l) order by l.refund_id) from (select * from latest order by refund_id limit 100) l),'[]'::jsonb),
  'limited',n>100)
 from totals
$$;
revoke all on function qw10_test.refund_snapshot(text,text,bigint) from public,anon,authenticated,service_role;

create or replace function private.qw10_test_review(p_action text,p_request text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare requested qw10_test.requests; old qw10_test.reconciliation_reviews; result jsonb;
begin
 if auth.uid() is null or private.is_admin() is distinct from true then raise exception 'Solo administradores' using errcode='42501';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(c) order by c.recorded_at desc),'[]') into result from (
   select r.id as request_id, r.session_id, p.amount_cents,p.recorded_at,
    qw10_test.refund_snapshot(r.id,p.payment_intent_id,p.amount_cents) as resolution,
    coalesce(e.reason,'legacy_review_required') as reason,
    (v.request_id is not null) as reviewed,v.note,v.reviewed_at,
    coalesce((select jsonb_agg(jsonb_build_object('sku',l.sku,'quantity',l.quantity) order by l.sku) from qw10_test.lines l where l.request_id=r.id),'[]') as items
   from qw10_test.requests r join qw10_test.receipts p on p.request_id=r.id
   left join qw10_test.fulfillment_events e on e.request_id=r.id
   left join qw10_test.reconciliation_reviews v on v.request_id=r.id
   where r.owner_id=auth.uid()::text and r.livemode=false and p.state='reconciliation_required'
   order by p.recorded_at desc limit 100
  ) c;
  return jsonb_build_object('environment','test','cases',result);
 end if;
 if p_action is distinct from 'review' or p_request is null or p_note is null or length(trim(p_note)) not between 12 and 500 then raise exception 'Invalid review';end if;
 select * into requested from qw10_test.requests where id=p_request and owner_id=auth.uid()::text and livemode=false for update;
 if not found or not exists(select 1 from qw10_test.receipts where request_id=p_request and state='reconciliation_required') then raise exception 'Review case unavailable';end if;
 select * into old from qw10_test.reconciliation_reviews where request_id=p_request;
 if found and (old.note is distinct from trim(p_note) or old.reviewed_by is distinct from auth.uid()) then raise exception 'Review already recorded';end if;
 insert into qw10_test.reconciliation_reviews(request_id,note,reviewed_by) values(p_request,trim(p_note),auth.uid()) on conflict(request_id) do nothing;
 return jsonb_build_object('environment','test','status','reviewed','requestId',p_request);
end$$;
