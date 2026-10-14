-- QW10 isolated database prototype. NOT a production migration.
-- Checkout request creation/reservation binding is deliberately not exposed.
create schema qw10_test;
revoke all on schema qw10_test from public;
create table qw10_test.requests (
  id text primary key,
  session_id text not null unique,
  total_cents bigint not null check(total_cents>0),
  livemode boolean not null,
  hold_until timestamptz not null,
  hold_active boolean not null default true
);
create table qw10_test.receipts (
  session_id text primary key references qw10_test.requests(session_id),
  payment_intent_id text not null unique,
  request_id text not null unique references qw10_test.requests(id),
  amount_cents bigint not null,
  state text not null check(state in ('paid','reconciliation_required')),
  first_event_id text not null,
  recorded_at timestamptz not null default clock_timestamp()
);
create table qw10_test.purchase_orders (
  id bigint generated always as identity primary key,
  request_id text not null unique references qw10_test.requests(id),
  session_id text not null unique references qw10_test.receipts(session_id),
  created_at timestamptz not null default clock_timestamp()
);
-- Isolated fixtures for the inventory transaction, not production tables.
create table qw10_test.stock (
  sku text primary key, quantity integer not null check(quantity>=0),
  active boolean not null default true
);
create table qw10_test.lines (
  request_id text not null references qw10_test.requests(id),
  sku text not null references qw10_test.stock(sku),
  quantity integer not null check(quantity>0),
  primary key(request_id,sku)
);
-- Simulates the other active QW9 quotation holds sharing these inventory locks.
create table qw10_test.quote_holds (
  reference text not null, sku text not null references qw10_test.stock(sku),
  quantity integer not null check(quantity>0), expires_at timestamptz not null,
  active boolean not null default true, primary key(reference,sku)
);
create table qw10_test.movements (
  request_id text not null references qw10_test.purchase_orders(request_id),
  sku text not null references qw10_test.stock(sku), quantity integer not null check(quantity>0),
  primary key(request_id,sku)
);
alter table qw10_test.requests enable row level security;
alter table qw10_test.receipts enable row level security;
alter table qw10_test.purchase_orders enable row level security;
alter table qw10_test.stock enable row level security;
alter table qw10_test.lines enable row level security;
alter table qw10_test.quote_holds enable row level security;
alter table qw10_test.movements enable row level security;
revoke all on all tables in schema qw10_test from public;

create function qw10_test.commit_payment(p_request text,p_session text,p_payment text,
  p_amount bigint,p_currency text,p_live boolean,p_event text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r qw10_test.requests; existing qw10_test.receipts; outcome text; order_id bigint;
begin
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
$$;
revoke all on function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) from public;
