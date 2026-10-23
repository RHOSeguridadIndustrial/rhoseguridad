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
