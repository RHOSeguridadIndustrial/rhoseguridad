-- Administrative simulation only. No bank integration or production inventory access.
-- Preserve Stripe IDs and provenance: transfer correlations have their own prefix,
-- payment_intent_id remains NULL, and the administrator is recorded separately.
alter table qw10_test.requests drop constraint requests_session_id_check;
alter table qw10_test.requests add constraint requests_session_id_check check(
 session_id is null or session_id ~ '^cs_test_[A-Za-z0-9_]+$' or
 (session_id ~ '^tr_test_[a-f0-9]{32}$' and quote->>'paymentMethod' is not distinct from 'transfer'));
alter table qw10_test.receipts alter column payment_intent_id drop not null;
alter table qw10_test.receipts add constraint receipts_payment_identity_check check(
 (session_id ~ '^cs_test_[A-Za-z0-9_]+$' and payment_intent_id is not null) or
 (session_id ~ '^tr_test_[a-f0-9]{32}$' and payment_intent_id is null));
alter table qw10_test.fulfillment_events drop constraint fulfillment_events_actor_kind_check;
alter table qw10_test.fulfillment_events drop constraint fulfillment_events_actor_name_check;
alter table qw10_test.fulfillment_events add constraint fulfillment_events_actor_check check(
 (actor_kind='system' and actor_name='stripe-test-orders') or
 (actor_kind='administrator' and actor_name='admin-transfer-pruebas'));

create table qw10_test.transfer_confirmations (
 request_id text primary key references qw10_test.requests(id),
 correlation_id text not null unique check(correlation_id ~ '^tr_test_[a-f0-9]{32}$'),
 reference text not null unique check(reference ~ '^BANKTEST-[A-Z0-9-]{8,64}$'),
 amount_cents bigint not null check(amount_cents>0),
 recorded_by uuid not null references auth.users(id),
 recorded_at timestamptz not null default clock_timestamp()
);
create index transfer_confirmations_recorded_by on qw10_test.transfer_confirmations(recorded_by);
alter table qw10_test.transfer_confirmations enable row level security;
revoke all on qw10_test.transfer_confirmations from public,anon,authenticated,service_role;

create role qw10_transfer_executor nologin noinherit nobypassrls;
grant qw10_transfer_executor to current_user with inherit false,set true;
grant usage on schema qw10_test,private,auth to qw10_transfer_executor;
grant execute on function auth.uid(),private.is_admin() to qw10_transfer_executor;
grant select on qw10_test.requests,qw10_test.lines,qw10_test.stock,qw10_test.quote_holds,
 qw10_test.receipts,qw10_test.purchase_orders,qw10_test.movements,
 qw10_test.preparation_events,qw10_test.transfer_confirmations to qw10_transfer_executor;
grant update(session_id,hold_active) on qw10_test.requests to qw10_transfer_executor;
grant update(quantity) on qw10_test.stock to qw10_transfer_executor;
grant insert on qw10_test.receipts,qw10_test.purchase_orders,qw10_test.movements,
 qw10_test.fulfillment_events,qw10_test.preparation_events,qw10_test.transfer_confirmations to qw10_transfer_executor;
grant usage,select on sequence qw10_test.purchase_orders_id_seq to qw10_transfer_executor;
do $$declare t text;begin
 foreach t in array array['requests','lines','stock','quote_holds','receipts','purchase_orders','movements','preparation_events','transfer_confirmations'] loop
  execute format('create policy transfer_executor_read on qw10_test.%I for select to qw10_transfer_executor using(true)',t);
 end loop;
 foreach t in array array['requests','stock'] loop
  execute format('create policy transfer_executor_update on qw10_test.%I for update to qw10_transfer_executor using(true) with check(true)',t);
 end loop;
 foreach t in array array['receipts','purchase_orders','movements','fulfillment_events','preparation_events','transfer_confirmations'] loop
  execute format('create policy transfer_executor_insert on qw10_test.%I for insert to qw10_transfer_executor with check(true)',t);
 end loop;
end$$;

create function qw10_test.transfer_snapshot(p_owner text,p_request text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x."requestId"),'[]'::jsonb) from (
 select r.id as "requestId",r.total_cents as "totalCents",r.expires_at as "expiresAt",
  (not r.hold_active or r.hold_until<=clock_timestamp() or r.expires_at<=extract(epoch from clock_timestamp())) as expired,
  coalesce(p.state,'awaiting_confirmation') as state,o.id as "orderId",
  c.reference as "receiptReference",c.recorded_at as "recordedAt",
  case when exists(select 1 from qw10_test.preparation_events e where e.request_id=r.id and e.action='dispatch') then 'dispatched'
   when exists(select 1 from qw10_test.preparation_events e where e.request_id=r.id and e.action='prepare') then 'prepared'
   when o.id is not null then 'pending' else 'none' end as preparation,
  coalesce(r.quote->'lines','[]'::jsonb) as items
 from qw10_test.requests r
 left join qw10_test.receipts p on p.request_id=r.id
 left join qw10_test.transfer_confirmations c on c.request_id=r.id
 left join qw10_test.purchase_orders o on o.request_id=r.id
 where r.owner_id=p_owner and r.livemode=false and r.quote->>'paymentMethod'='transfer'
  and (p_request is null or r.id=p_request)
 order by (p.state is null) desc,r.expires_at desc,r.id limit 100
 ) x
$$;
revoke all on function qw10_test.transfer_snapshot(text,text) from public,anon,authenticated,service_role;
grant execute on function qw10_test.transfer_snapshot(text,text) to qw10_transfer_executor;

create function private.qw10_test_transfer(p_action text,p_request text,p_reference text,p_amount bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r qw10_test.requests; old qw10_test.transfer_confirmations; why text;
 correlation text; event_id text; outcome text; order_id bigint; result jsonb; total bigint;
begin
 if auth.uid() is null or private.is_admin() is distinct from true then raise exception 'Solo administradores' using errcode='42501';end if;
 if p_action='list' then
  if p_request is not null or p_reference is not null or p_amount is not null then raise exception 'Invalid list';end if;
  select count(*) into total from qw10_test.requests where owner_id=auth.uid()::text and livemode=false and quote->>'paymentMethod'='transfer';
  return jsonb_build_object('environment','test','transfers',qw10_test.transfer_snapshot(auth.uid()::text,null),'limited',total>100);
 end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Fresh transaction required';end if;
 if p_action is null or p_action not in ('confirm','prepare','dispatch') or p_request is null then raise exception 'Invalid action';end if;
 select * into r from qw10_test.requests where id=p_request and owner_id=auth.uid()::text and livemode=false and quote->>'paymentMethod'='transfer' for update;
 if not found then raise exception 'Transfer unavailable';end if;
 if p_action='confirm' then
  if p_reference is null or p_reference !~ '^BANKTEST-[A-Z0-9-]{8,64}$' or p_amount is distinct from r.total_cents then raise exception 'Confirmation mismatch';end if;
  select * into old from qw10_test.transfer_confirmations where request_id=p_request;
  if found then
   if old.reference is distinct from p_reference or old.amount_cents is distinct from p_amount or old.recorded_by is distinct from auth.uid() then raise exception 'Confirmation retry conflict';end if;
   return jsonb_build_object('environment','test','transfer',qw10_test.transfer_snapshot(auth.uid()::text,p_request)->0,'repeated',true);
  end if;
  if r.session_id is not null or exists(select 1 from qw10_test.receipts where request_id=p_request) then raise exception 'Payment already bound';end if;
  if r.expires_at is null or r.quote->>'currency' is distinct from 'mxn' or r.quote->'totalCents' is distinct from to_jsonb(r.total_cents) then raise exception 'Invalid transfer quote';end if;
  perform 1 from qw10_test.stock s join qw10_test.lines l on l.sku=s.sku where l.request_id=p_request order by s.sku for update of s;
  if not r.hold_active then why:='reservation_inactive';
  elsif r.hold_until<=clock_timestamp() or r.expires_at<=extract(epoch from clock_timestamp()) then why:='reservation_expired';end if;
  if not exists(select 1 from qw10_test.lines where request_id=p_request) then why:=coalesce(why,'empty_request');end if;
  if exists(select 1 from qw10_test.lines l left join qw10_test.stock s using(sku)
   where l.request_id=p_request and (s.sku is null or not s.active or s.quantity<l.quantity+
    coalesce((select sum(q.quantity) from qw10_test.quote_holds q where q.sku=l.sku and q.active and q.expires_at>clock_timestamp()),0)+
    coalesce((select sum(o.quantity) from qw10_test.lines o join qw10_test.requests h on h.id=o.request_id
     where o.sku=l.sku and h.id<>p_request and h.hold_active and h.hold_until>clock_timestamp()),0))) then why:=coalesce(why,'stock_unavailable');end if;
  outcome:=case when why is null then 'paid' else 'reconciliation_required' end;
  correlation:='tr_test_'||replace(gen_random_uuid()::text,'-','');event_id:='transfer_test_'||substring(correlation from 9);
  insert into qw10_test.transfer_confirmations(request_id,correlation_id,reference,amount_cents,recorded_by) values(p_request,correlation,p_reference,p_amount,auth.uid());
  update qw10_test.requests set session_id=correlation,hold_active=false where id=p_request;
  insert into qw10_test.receipts(session_id,payment_intent_id,request_id,amount_cents,state,first_event_id) values(correlation,null,p_request,p_amount,outcome,event_id);
  insert into qw10_test.fulfillment_events(request_id,source_event,actor_kind,actor_name,outcome,reason) values(p_request,event_id,'administrator','admin-transfer-pruebas',outcome,why);
  if outcome='paid' then
   insert into qw10_test.purchase_orders(request_id,session_id) values(p_request,correlation) returning id into order_id;
   update qw10_test.stock s set quantity=s.quantity-l.quantity from qw10_test.lines l where l.request_id=p_request and l.sku=s.sku;
   insert into qw10_test.movements(request_id,sku,quantity) select p_request,sku,quantity from qw10_test.lines where request_id=p_request;
  end if;
 else
  if p_reference is not null or p_amount is not null then raise exception 'Invalid preparation';end if;
  if not exists(select 1 from qw10_test.transfer_confirmations c join qw10_test.receipts p on p.request_id=c.request_id and p.session_id=c.correlation_id
    join qw10_test.purchase_orders o on o.request_id=p.request_id and o.session_id=p.session_id where c.request_id=p_request and p.state='paid') then raise exception 'Confirmed transfer order required';end if;
  if p_action='dispatch' and not exists(select 1 from qw10_test.preparation_events where request_id=p_request and action='prepare') then raise exception 'Preparation required';end if;
  insert into qw10_test.preparation_events(request_id,action,actor) values(p_request,p_action,auth.uid()::text) on conflict(request_id,action) do nothing;
 end if;
 return jsonb_build_object('environment','test','transfer',qw10_test.transfer_snapshot(auth.uid()::text,p_request)->0,'repeated',false);
end$$;
revoke all on function private.qw10_test_transfer(text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function private.qw10_test_transfer(text,text,text,bigint) to authenticated;
grant create on schema private to qw10_transfer_executor;
alter function private.qw10_test_transfer(text,text,text,bigint) owner to qw10_transfer_executor;
revoke create on schema private from qw10_transfer_executor;
create function public.qw10_test_transfer(p_action text,p_request text default null,p_reference text default null,p_amount bigint default null)
returns jsonb language sql security invoker set search_path='' as $$select private.qw10_test_transfer(p_action,p_request,p_reference,p_amount)$$;
revoke all on function public.qw10_test_transfer(text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.qw10_test_transfer(text,text,text,bigint) to authenticated;
