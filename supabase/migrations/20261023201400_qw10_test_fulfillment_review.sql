-- Deployed test flow only. No public inventory, orders, or real payment writes.
-- The existing signed webhook is the trusted producer; clients cannot call it.
-- Tighten the service boundary: fulfillment can only enter through its RPC.
create role qw10_fulfillment nologin noinherit nobypassrls;
grant usage on schema qw10_test to qw10_fulfillment;
grant select on all tables in schema qw10_test to qw10_fulfillment;
grant update(hold_active) on qw10_test.requests to qw10_fulfillment;
grant update(quantity) on qw10_test.stock to qw10_fulfillment;
grant insert on qw10_test.receipts,qw10_test.purchase_orders,qw10_test.movements to qw10_fulfillment;
grant usage,select on sequence qw10_test.purchase_orders_id_seq to qw10_fulfillment;
do $$declare t text;begin
 foreach t in array array['requests','receipts','purchase_orders','movements','stock','lines','quote_holds'] loop
  execute format('create policy fulfillment_read on qw10_test.%I for select to qw10_fulfillment using(true)',t);
 end loop;
 foreach t in array array['requests','stock'] loop
  execute format('create policy fulfillment_update on qw10_test.%I for update to qw10_fulfillment using(true) with check(true)',t);
 end loop;
 foreach t in array array['receipts','purchase_orders','movements'] loop
  execute format('create policy fulfillment_insert on qw10_test.%I for insert to qw10_fulfillment with check(true)',t);
 end loop;
end$$;

create unique index qw10_receipt_source_event on qw10_test.receipts(first_event_id);
create table qw10_test.fulfillment_events (
 request_id text primary key references qw10_test.receipts(request_id),
 source_event text not null unique,
 actor_kind text not null default 'system' check(actor_kind='system'),
 actor_name text not null default 'stripe-test-orders' check(actor_name='stripe-test-orders'),
 outcome text not null check(outcome in ('paid','reconciliation_required')),
 reason text check(reason in ('reservation_expired','reservation_inactive','empty_request','stock_unavailable')),
 recorded_at timestamptz not null default clock_timestamp(),
 check((outcome='paid' and reason is null) or (outcome='reconciliation_required' and reason is not null))
);
alter table qw10_test.fulfillment_events enable row level security;
revoke all on qw10_test.fulfillment_events from public,anon,authenticated,service_role;
grant select,insert on qw10_test.fulfillment_events to qw10_fulfillment;
create policy fulfillment_event_read on qw10_test.fulfillment_events for select to qw10_fulfillment using(true);
create policy fulfillment_event_insert on qw10_test.fulfillment_events for insert to qw10_fulfillment with check(true);

create or replace function qw10_test.commit_payment(p_request text,p_session text,p_payment text,p_amount bigint,p_currency text,p_live boolean,p_event text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r qw10_test.requests; existing qw10_test.receipts; outcome text; why text; order_id bigint;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Fresh transaction required';end if;
 if p_live is distinct from false or p_session is null or p_session !~ '^cs_test_[A-Za-z0-9_]+$' then raise exception 'Test environment required';end if;
 if p_event is null or p_event !~ '^evt_[A-Za-z0-9_]+$' or p_payment is null or p_payment !~ '^pi_[A-Za-z0-9_]+$' then raise exception 'Invalid payment identity';end if;
 select * into r from qw10_test.requests where id=p_request for update;
 if not found or r.session_id is distinct from p_session or r.livemode is distinct from false
  or r.total_cents is distinct from p_amount or p_currency is distinct from 'mxn' then raise exception 'Payment binding mismatch';end if;
 select * into existing from qw10_test.receipts where session_id=p_session;
 if found then
  if existing.request_id is distinct from p_request or existing.payment_intent_id is distinct from p_payment or existing.amount_cents is distinct from p_amount then raise exception 'Payment retry conflict';end if;
  select id into order_id from qw10_test.purchase_orders where request_id=p_request;
  return jsonb_build_object('status',existing.state,'orderId',order_id,'repeated',true);
 end if;
 perform 1 from qw10_test.stock s join qw10_test.lines l on l.sku=s.sku where l.request_id=p_request order by s.sku for update of s;
 -- Clock is read after any wait. Never fulfill an expired reservation.
 if not r.hold_active then why:='reservation_inactive';
 elsif r.hold_until<=clock_timestamp() then why:='reservation_expired';end if;
 if not exists(select 1 from qw10_test.lines where request_id=p_request) then why:=coalesce(why,'empty_request');end if;
 if exists(select 1 from qw10_test.lines l left join qw10_test.stock s using(sku)
  where l.request_id=p_request and (s.sku is null or not s.active or s.quantity<l.quantity+
   coalesce((select sum(q.quantity) from qw10_test.quote_holds q where q.sku=l.sku and q.active and q.expires_at>clock_timestamp()),0)+
   coalesce((select sum(o.quantity) from qw10_test.lines o join qw10_test.requests h on h.id=o.request_id
    where o.sku=l.sku and h.id<>p_request and h.hold_active and h.hold_until>clock_timestamp()),0))) then why:=coalesce(why,'stock_unavailable');end if;
 outcome:=case when why is null then 'paid' else 'reconciliation_required' end;
 insert into qw10_test.receipts(session_id,payment_intent_id,request_id,amount_cents,state,first_event_id) values(p_session,p_payment,p_request,p_amount,outcome,p_event);
 insert into qw10_test.fulfillment_events(request_id,source_event,outcome,reason) values(p_request,p_event,outcome,why);
 if outcome='paid' then
  insert into qw10_test.purchase_orders(request_id,session_id) values(p_request,p_session) returning id into order_id;
  update qw10_test.stock s set quantity=s.quantity-l.quantity from qw10_test.lines l where l.request_id=p_request and l.sku=s.sku;
  insert into qw10_test.movements(request_id,sku,quantity) select p_request,sku,quantity from qw10_test.lines where request_id=p_request;
 end if;
 update qw10_test.requests set hold_active=false where id=p_request;
 return jsonb_build_object('status',outcome,'orderId',order_id,'repeated',false);
end$$;
grant create on schema qw10_test to qw10_fulfillment;
alter function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) owner to qw10_fulfillment;
revoke create on schema qw10_test from qw10_fulfillment;
revoke all on function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) from public,anon,authenticated;
grant execute on function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) to service_role;
revoke insert on qw10_test.receipts,qw10_test.purchase_orders,qw10_test.movements from service_role;
revoke update on qw10_test.stock from service_role;
-- Immutable evidence is never updated by a client, administrator or backend.
create table qw10_test.reconciliation_reviews (
 request_id text primary key references qw10_test.receipts(request_id),
 note text not null check(length(trim(note)) between 12 and 500),
 reviewed_by uuid not null references auth.users(id),
 reviewed_at timestamptz not null default clock_timestamp()
);
alter table qw10_test.reconciliation_reviews enable row level security;
revoke all on qw10_test.reconciliation_reviews from public,anon,authenticated,service_role;

-- The internal administrator path checks the live session/MFA on every call.
create function private.qw10_test_review(p_action text,p_request text,p_note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare requested qw10_test.requests; old qw10_test.reconciliation_reviews; result jsonb;
begin
 if auth.uid() is null or private.is_admin() is distinct from true then raise exception 'Solo administradores' using errcode='42501';end if;
 if p_action='list' then
  select coalesce(jsonb_agg(to_jsonb(c) order by c.recorded_at desc),'[]') into result from (
   select r.id as request_id, r.session_id, p.amount_cents,p.recorded_at,
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
revoke all on function private.qw10_test_review(text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.qw10_test_review(text,text,text) to authenticated;
create function public.qw10_test_review(p_action text,p_request text default null,p_note text default null)
returns jsonb language sql security invoker set search_path='' as $$select private.qw10_test_review(p_action,p_request,p_note)$$;
revoke all on function public.qw10_test_review(text,text,text) from public,anon,service_role;
grant execute on function public.qw10_test_review(text,text,text) to authenticated;

-- Row-locking also requires UPDATE privilege. Keep it inside a no-login executor
-- rather than restoring direct stock UPDATE to the calling backend.
create function qw10_test.lock_stock(p_skus text[]) returns void
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Fresh transaction required';end if;
 perform 1 from qw10_test.stock s where s.sku=any(p_skus) order by s.sku for update;
end$$;
grant create on schema qw10_test to qw10_fulfillment;
alter function qw10_test.lock_stock(text[]) owner to qw10_fulfillment;
revoke create on schema qw10_test from qw10_fulfillment;
revoke all on function qw10_test.lock_stock(text[]) from public,anon,authenticated;
grant execute on function qw10_test.lock_stock(text[]) to service_role;

CREATE OR REPLACE FUNCTION public.qw10_test_reserve(p_owner text, p_retry text, p_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r qw10_test.requests; k text; q bigint; expires bigint;
begin
 if p_owner is null or length(p_owner)<1 or length(p_owner)>120 or
    p_retry is null or p_retry !~ '^[A-Za-z0-9_-]{16,100}$' or
    p_quote->>'currency' is distinct from 'mxn' or
    jsonb_typeof(p_quote->'lines') is distinct from 'array' or
    jsonb_array_length(p_quote->'lines') not between 1 and 100 or
    (p_quote->>'totalCents')::bigint<=0 then raise exception 'Invalid test quote'; end if;
 -- Serialize this identity before stock locks; retries cannot create two requests.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner||':'||p_retry,0));
 select * into r from qw10_test.requests where owner_id=p_owner and retry_key=p_retry for update;
 if found then
   if r.quote is distinct from p_quote or not r.hold_active or r.hold_until<=clock_timestamp()
     then raise exception 'Retry payload changed or hold expired'; end if;
   return jsonb_build_object('id',r.id,'quote',r.quote,'expiresAt',r.expires_at,'livemode',false);
 end if;
 if exists(select 1 from jsonb_array_elements(p_quote->'lines') l
   where l->>'sku' is null or l->>'sku' !~ '^[a-z0-9][a-z0-9-]{1,119}$'
    or l->>'quantity' is null or l->>'quantity' !~ '^[1-9][0-9]{0,6}$'
    or (l->>'quantity')::bigint>1000000) or
   (select count(distinct l->>'sku') from jsonb_array_elements(p_quote->'lines') l)
     <>jsonb_array_length(p_quote->'lines') then raise exception 'Invalid test lines'; end if;
 perform qw10_test.lock_stock(array(select l->>'sku' from jsonb_array_elements(p_quote->'lines') l));
 for k,q in select l->>'sku',(l->>'quantity')::bigint from jsonb_array_elements(p_quote->'lines') l loop
   if not exists(select 1 from qw10_test.stock s where s.sku=k and s.active and s.quantity>=q+
      coalesce((select sum(l.quantity) from qw10_test.lines l join qw10_test.requests h on h.id=l.request_id
        where l.sku=k and h.hold_active and h.hold_until>clock_timestamp()),0)+
      coalesce((select sum(h.quantity) from qw10_test.quote_holds h
        where h.sku=k and h.active and h.expires_at>clock_timestamp()),0))
      then raise exception 'Insufficient test stock'; end if;
 end loop;
 expires:=floor(extract(epoch from clock_timestamp()+interval '32 minutes'))::bigint;
 insert into qw10_test.requests(id,total_cents,livemode,hold_until,owner_id,retry_key,quote,expires_at)
   values(pg_catalog.gen_random_uuid()::text,(p_quote->>'totalCents')::bigint,false,
     to_timestamp(expires)+interval '5 minutes',p_owner,p_retry,p_quote,expires) returning * into r;
 insert into qw10_test.lines(request_id,sku,quantity)
   select r.id,l->>'sku',(l->>'quantity')::int from jsonb_array_elements(p_quote->'lines') l;
 return jsonb_build_object('id',r.id,'quote',r.quote,'expiresAt',r.expires_at,'livemode',false);
end; $function$
;
CREATE OR REPLACE FUNCTION public.qw10_test_special_order(p_owner text, p_retry text, p_sku text, p_quantity integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r qw10_test.special_requests; available bigint; reserved integer; deadline timestamptz; ref text;
begin
 if p_owner is null or length(p_owner) not between 1 and 120 or p_retry is null or p_retry !~ '^[a-zA-Z0-9_-]{16,100}$' or p_sku is null or p_quantity is null or p_quantity not between 1 and 1000000 then raise exception 'Invalid test request';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('special:'||p_owner||':'||p_retry,0));
 select * into r from qw10_test.special_requests where owner_id=p_owner and retry_key=p_retry;
 if found then
  if r.sku<>p_sku or r.requested<>p_quantity or r.expires_at<=clock_timestamp() then raise exception 'Retry changed or expired';end if;
 else
  perform qw10_test.lock_stock(array[p_sku]);
  if not exists(select 1 from qw10_test.stock where sku=p_sku and active) then raise exception 'Unknown test variant';end if;
  select greatest(0,s.quantity-
   coalesce((select sum(l.quantity) from qw10_test.lines l join qw10_test.requests h on h.id=l.request_id where l.sku=p_sku and h.hold_active and h.hold_until>clock_timestamp()),0)-
   coalesce((select sum(h.quantity) from qw10_test.quote_holds h where h.sku=p_sku and h.active and h.expires_at>clock_timestamp()),0)) into available from qw10_test.stock s where s.sku=p_sku;
  reserved:=least(available,p_quantity);ref:='test-special-'||pg_catalog.gen_random_uuid()::text;deadline:=clock_timestamp()+interval '30 minutes';
  insert into qw10_test.special_requests values(ref,p_owner,p_retry,p_sku,p_quantity,reserved,p_quantity-reserved,deadline) returning * into r;
  if reserved>0 then insert into qw10_test.quote_holds values(ref,p_sku,reserved,deadline,true);end if;
 end if;
 return jsonb_build_object('environment','test','reference',r.id,'sku',r.sku,'requested',r.requested,'reserved',r.reserved,'additional',r.additional,'expiresAt',r.expires_at);
end;$function$
;
