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
alter table qw10_test.requests enable row level security;
alter table qw10_test.receipts enable row level security;
alter table qw10_test.purchase_orders enable row level security;
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
  insert into qw10_test.receipts(session_id,payment_intent_id,request_id,amount_cents,state,first_event_id)
    values(p_session,p_payment,p_request,p_amount,outcome,p_event);
  if outcome='paid' then
    insert into qw10_test.purchase_orders(request_id,session_id) values(p_request,p_session)
      returning id into order_id;
  end if;
  return jsonb_build_object('status',outcome,'orderId',order_id,'repeated',false);
end;
$$;
revoke all on function qw10_test.commit_payment(text,text,text,bigint,text,boolean,text) from public;
