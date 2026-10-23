-- Non-destructive rollback. Keep new actor/review evidence and historical data.
-- Restore the previous test consumer and its exact service grants; leave live stock untouched.
CREATE OR REPLACE FUNCTION qw10_test.commit_payment(p_request text, p_session text, p_payment text, p_amount bigint, p_currency text, p_live boolean, p_event text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r qw10_test.requests; existing qw10_test.receipts; outcome text; order_id bigint;
begin
  if p_live is distinct from false or p_session is null or p_session !~ '^cs_test_[A-Za-z0-9_]+$' then
    raise exception 'Test environment required';
  end if;
  if p_event is null or p_event !~ '^evt_[A-Za-z0-9_]+$'
    or p_payment is null or p_payment !~ '^pi_[A-Za-z0-9_]+$' then
    raise exception 'Invalid payment identity';
  end if;
  select * into r from qw10_test.requests where id=p_request for update;
  if not found or r.session_id is distinct from p_session or r.livemode is distinct from p_live
    or r.total_cents is distinct from p_amount or p_currency is distinct from 'mxn' then
    raise exception 'Payment binding mismatch';
  end if;
  select * into existing from qw10_test.receipts where session_id=p_session;
  if found then
    if existing.payment_intent_id<>p_payment or existing.amount_cents<>p_amount then
      raise exception 'Payment retry conflict';
    end if;
    select id into order_id from qw10_test.purchase_orders where request_id=p_request;
    return jsonb_build_object('status',existing.state,'orderId',order_id,'repeated',true);
  end if;
  outcome:=case when r.hold_active and r.hold_until>clock_timestamp()
    then 'paid' else 'reconciliation_required' end;
  -- Every stock writer must use these same sorted row locks in production.
  perform 1 from qw10_test.stock s join qw10_test.lines l on l.sku=s.sku
    where l.request_id=p_request order by s.sku for update of s;
  -- Recheck the deadline AFTER waiting for stock locks.
  if not r.hold_active or r.hold_until<=clock_timestamp() then
    outcome:='reconciliation_required';
  end if;
  if not exists(select 1 from qw10_test.lines where request_id=p_request)
    or exists(select 1 from qw10_test.lines l join qw10_test.stock s using(sku)
      where l.request_id=p_request and (not s.active or s.quantity<l.quantity+
        coalesce((select sum(q.quantity) from qw10_test.quote_holds q
          where q.sku=l.sku and q.active and q.expires_at>clock_timestamp()),0)+
        coalesce((select sum(o.quantity) from qw10_test.lines o
          join qw10_test.requests h on h.id=o.request_id
          where o.sku=l.sku and h.id<>p_request and h.hold_active
            and h.hold_until>clock_timestamp()),0))) then
    outcome:='reconciliation_required';
  end if;
  insert into qw10_test.receipts(session_id,payment_intent_id,request_id,amount_cents,state,first_event_id)
    values(p_session,p_payment,p_request,p_amount,outcome,p_event);
  if outcome='paid' then
    insert into qw10_test.purchase_orders(request_id,session_id) values(p_request,p_session)
      returning id into order_id;
    update qw10_test.stock s set quantity=s.quantity-l.quantity
      from qw10_test.lines l where l.request_id=p_request and l.sku=s.sku;
    insert into qw10_test.movements(request_id,sku,quantity)
      select p_request,sku,quantity from qw10_test.lines where request_id=p_request;
    update qw10_test.requests set hold_active=false where id=p_request;
  else
    -- Payment is recorded for manual reconciliation; no partial stock deduction.
    update qw10_test.requests set hold_active=false where id=p_request;
  end if;
  return jsonb_build_object('status',outcome,'orderId',order_id,'repeated',false);
end;
$function$
;
alter function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) owner to postgres;
alter function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) security invoker;
revoke all on function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) from public,anon,authenticated;
grant execute on function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) to service_role;
grant insert on qw10_test.receipts,qw10_test.purchase_orders,qw10_test.movements to service_role;
grant update on qw10_test.stock to service_role;
-- Stop new review writes; existing private evidence stays intact.
revoke execute on function public.qw10_test_review(text,text,text) from authenticated;
revoke execute on function private.qw10_test_review(text,text,text) from authenticated;

-- Restore original reservation locking before retiring the helper.
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
 perform 1 from qw10_test.stock s where s.sku in
   (select l->>'sku' from jsonb_array_elements(p_quote->'lines') l) order by s.sku for update;
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
  perform 1 from qw10_test.stock where sku=p_sku and active for update;
  if not found then raise exception 'Unknown test variant';end if;
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
revoke execute on function qw10_test.lock_stock(text[]) from service_role;
