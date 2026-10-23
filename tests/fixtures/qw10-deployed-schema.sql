-- Sanitized schema-only snapshot of qw10_test on 2026-10-23. No remote records or credentials.

create role anon; create role authenticated; create role service_role bypassrls;

create schema qw10_test; create schema private; create schema auth;

create table auth.users(id uuid primary key);

create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;

create function private.is_admin() returns boolean language sql as $$select auth.uid()='11111111-1111-4111-8111-111111111111'::uuid and current_setting('test.aal',true)='aal2'$$;

grant usage on schema public,qw10_test to service_role; grant usage on schema auth,private to authenticated;

create table qw10_test.lines("request_id" text not null,
"sku" text not null,
"quantity" integer not null);

create table qw10_test.movements("request_id" text not null,
"sku" text not null,
"quantity" integer not null);

create table qw10_test.preparation_events("request_id" text not null,
"action" text not null,
"actor" text not null,
"recorded_at" timestamp with time zone default clock_timestamp() not null);

create table qw10_test.purchase_orders("id" bigint generated always as identity not null,
"request_id" text not null,
"session_id" text not null,
"created_at" timestamp with time zone default clock_timestamp() not null);

create table qw10_test.quote_holds("reference" text not null,
"sku" text not null,
"quantity" integer not null,
"expires_at" timestamp with time zone not null,
"active" boolean default true not null);

create table qw10_test.receipts("session_id" text not null,
"payment_intent_id" text not null,
"request_id" text not null,
"amount_cents" bigint not null,
"state" text not null,
"first_event_id" text not null,
"recorded_at" timestamp with time zone default clock_timestamp() not null);

create table qw10_test.requests("id" text not null,
"session_id" text,
"total_cents" bigint not null,
"livemode" boolean not null,
"hold_until" timestamp with time zone not null,
"hold_active" boolean default true not null,
"owner_id" text,
"retry_key" text,
"quote" jsonb,
"expires_at" bigint,
"checkout_identity" text);

create table qw10_test.special_requests("id" text not null,
"owner_id" text not null,
"retry_key" text not null,
"sku" text not null,
"requested" integer not null,
"reserved" integer not null,
"additional" integer not null,
"expires_at" timestamp with time zone not null);

create table qw10_test.stock("sku" text not null,
"quantity" integer not null,
"active" boolean default true not null);

alter table qw10_test.lines add constraint lines_pkey PRIMARY KEY (request_id, sku);

alter table qw10_test.movements add constraint movements_pkey PRIMARY KEY (request_id, sku);

alter table qw10_test.preparation_events add constraint preparation_events_pkey PRIMARY KEY (request_id, action);

alter table qw10_test.purchase_orders add constraint purchase_orders_pkey PRIMARY KEY (id);

alter table qw10_test.quote_holds add constraint quote_holds_pkey PRIMARY KEY (reference, sku);

alter table qw10_test.receipts add constraint receipts_pkey PRIMARY KEY (session_id);

alter table qw10_test.requests add constraint requests_pkey PRIMARY KEY (id);

alter table qw10_test.special_requests add constraint special_requests_pkey PRIMARY KEY (id);

alter table qw10_test.stock add constraint stock_pkey PRIMARY KEY (sku);

alter table qw10_test.purchase_orders add constraint purchase_orders_request_id_key UNIQUE (request_id);

alter table qw10_test.purchase_orders add constraint purchase_orders_session_id_key UNIQUE (session_id);

alter table qw10_test.receipts add constraint receipts_payment_intent_id_key UNIQUE (payment_intent_id);

alter table qw10_test.receipts add constraint receipts_request_id_key UNIQUE (request_id);

alter table qw10_test.requests add constraint requests_session_id_key UNIQUE (session_id);

alter table qw10_test.special_requests add constraint special_requests_owner_id_retry_key_key UNIQUE (owner_id, retry_key);

alter table qw10_test.lines add constraint lines_quantity_check CHECK ((quantity > 0));

alter table qw10_test.movements add constraint movements_quantity_check CHECK ((quantity > 0));

alter table qw10_test.preparation_events add constraint preparation_events_action_check CHECK ((action = ANY (ARRAY['prepare'::text, 'dispatch'::text])));

alter table qw10_test.preparation_events add constraint preparation_events_actor_check CHECK ((length(TRIM(BOTH FROM actor)) > 0));

alter table qw10_test.quote_holds add constraint quote_holds_quantity_check CHECK ((quantity > 0));

alter table qw10_test.receipts add constraint receipts_state_check CHECK ((state = ANY (ARRAY['paid'::text, 'reconciliation_required'::text])));

alter table qw10_test.requests add constraint requests_livemode_check CHECK ((livemode = false));

alter table qw10_test.requests add constraint requests_session_id_check CHECK ((session_id ~ '^cs_test_[A-Za-z0-9_]+$'::text));

alter table qw10_test.requests add constraint requests_total_cents_check CHECK ((total_cents > 0));

alter table qw10_test.special_requests add constraint special_requests_additional_check CHECK ((additional >= 0));

alter table qw10_test.special_requests add constraint special_requests_check CHECK ((requested = (reserved + additional)));

alter table qw10_test.special_requests add constraint special_requests_requested_check CHECK ((requested > 0));

alter table qw10_test.special_requests add constraint special_requests_reserved_check CHECK ((reserved >= 0));

alter table qw10_test.stock add constraint stock_quantity_check CHECK ((quantity >= 0));

alter table qw10_test.lines add constraint lines_request_id_fkey FOREIGN KEY (request_id) REFERENCES qw10_test.requests(id);

alter table qw10_test.lines add constraint lines_sku_fkey FOREIGN KEY (sku) REFERENCES qw10_test.stock(sku);

alter table qw10_test.movements add constraint movements_request_id_fkey FOREIGN KEY (request_id) REFERENCES qw10_test.purchase_orders(request_id);

alter table qw10_test.movements add constraint movements_sku_fkey FOREIGN KEY (sku) REFERENCES qw10_test.stock(sku);

alter table qw10_test.preparation_events add constraint preparation_events_request_id_fkey FOREIGN KEY (request_id) REFERENCES qw10_test.requests(id);

alter table qw10_test.purchase_orders add constraint purchase_orders_request_id_fkey FOREIGN KEY (request_id) REFERENCES qw10_test.requests(id);

alter table qw10_test.purchase_orders add constraint purchase_orders_session_id_fkey FOREIGN KEY (session_id) REFERENCES qw10_test.receipts(session_id);

alter table qw10_test.quote_holds add constraint quote_holds_sku_fkey FOREIGN KEY (sku) REFERENCES qw10_test.stock(sku);

alter table qw10_test.receipts add constraint receipts_request_id_fkey FOREIGN KEY (request_id) REFERENCES qw10_test.requests(id);

alter table qw10_test.receipts add constraint receipts_session_id_fkey FOREIGN KEY (session_id) REFERENCES qw10_test.requests(session_id);

alter table qw10_test.special_requests add constraint special_requests_sku_fkey FOREIGN KEY (sku) REFERENCES qw10_test.stock(sku);

alter table qw10_test.lines enable row level security;

grant insert,select on qw10_test.lines to service_role;

alter table qw10_test.movements enable row level security;

grant insert,select on qw10_test.movements to service_role;

alter table qw10_test.preparation_events enable row level security;

grant insert,select on qw10_test.preparation_events to service_role;

alter table qw10_test.purchase_orders enable row level security;

grant insert,select on qw10_test.purchase_orders to service_role;

alter table qw10_test.quote_holds enable row level security;

grant insert,select on qw10_test.quote_holds to service_role;

alter table qw10_test.receipts enable row level security;

grant insert,select on qw10_test.receipts to service_role;

alter table qw10_test.requests enable row level security;

grant insert,select,update on qw10_test.requests to service_role;

alter table qw10_test.special_requests enable row level security;

grant insert,select on qw10_test.special_requests to service_role;

alter table qw10_test.stock enable row level security;

grant select,update on qw10_test.stock to service_role;

grant usage, select on all sequences in schema qw10_test to service_role;

create unique index qw10_test_owner_retry on qw10_test.requests(owner_id,retry_key);

set check_function_bodies=off;

CREATE OR REPLACE FUNCTION public.qw10_test_order_status(p_owner text, p_session text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('environment','test','state',
   case when p.state='paid' and o.id is not null then 'paid'
        when p.state='reconciliation_required' then 'reconciliation_required'
        else 'pending' end,
   'orderId',case when p.state='paid' then o.id::text else null end,
   'quote',r.quote,
   'preparation',jsonb_build_object('state',case
     when exists(select 1 from qw10_test.preparation_events e where e.request_id=r.id and e.action='dispatch') then 'dispatched'
     when exists(select 1 from qw10_test.preparation_events e where e.request_id=r.id and e.action='prepare') then 'prepared'
     else 'pending' end))
 from qw10_test.requests r
 left join qw10_test.receipts p on p.request_id=r.id
 left join qw10_test.purchase_orders o on o.request_id=r.id
 where r.owner_id=p_owner and r.session_id=p_session and r.livemode=false
 and p_session like 'cs_test_%';
$function$
;

CREATE OR REPLACE FUNCTION public.qw10_test_load_reservation(p_owner text, p_retry text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r qw10_test.requests;
begin
 if p_owner is null or length(p_owner) not between 1 and 120 or
    p_retry is null or p_retry !~ '^[A-Za-z0-9_-]{16,100}$' then
   raise exception 'Invalid checkout identity';
 end if;
 select * into r from qw10_test.requests where owner_id=p_owner and retry_key=p_retry;
 if not found then return null; end if;
 -- Old records are not inferred or backfilled from untrusted input.
 if r.checkout_identity is null or r.livemode is distinct from false or
    not r.hold_active or r.hold_until<=clock_timestamp() or
    r.expires_at<=extract(epoch from clock_timestamp()) then
   raise exception 'Unavailable saved test reservation';
 end if;
 return jsonb_build_object('id',r.id,'ownerId',r.owner_id,'retryKey',r.retry_key,
   'checkoutIdentity',r.checkout_identity,'quote',r.quote,'expiresAt',r.expires_at,'livemode',false);
end; $function$
;

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

CREATE OR REPLACE FUNCTION public.qw10_test_reserve_v2(p_owner text, p_retry text, p_quote jsonb, p_identity text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare saved jsonb; created jsonb; identity_json jsonb;
begin
 if p_owner is null or length(p_owner) not between 1 and 120 or
    p_retry is null or p_retry !~ '^[A-Za-z0-9_-]{16,100}$' or
    p_identity is null or length(p_identity)>20000 then raise exception 'Invalid checkout identity'; end if;
 identity_json:=p_identity::jsonb;
 if jsonb_typeof(identity_json->'items') is distinct from 'array' or
    jsonb_typeof(identity_json->'address') is distinct from 'object' or
    identity_json->'address'->>'postalCode' is distinct from '02000' or
    (select jsonb_agg(jsonb_build_object('sku',l->>'sku','quantity',l->'quantity') order by l->>'sku')
       from jsonb_array_elements(p_quote->'lines') l) is distinct from identity_json->'items'
    then raise exception 'Quote input binding mismatch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner||':'||p_retry,0));
 saved:=public.qw10_test_load_reservation(p_owner,p_retry);
 if saved is not null then
   if saved->>'checkoutIdentity' is distinct from p_identity then raise exception 'Retry changed'; end if;
   -- Another first attempt may have won with older prices. Return that winner.
   return saved;
 end if;
 created:=public.qw10_test_reserve(p_owner,p_retry,p_quote);
 update qw10_test.requests set checkout_identity=p_identity
   where id=created->>'id' and owner_id=p_owner and retry_key=p_retry;
 return public.qw10_test_load_reservation(p_owner,p_retry);
end; $function$
;

CREATE OR REPLACE FUNCTION public.qw10_test_load_request(p_session text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select jsonb_build_object('id',id,'sessionId',session_id,'totalCents',total_cents,'livemode',livemode) from qw10_test.requests where session_id=p_session and livemode=false and p_session ~ '^cs_test_[A-Za-z0-9_]+$'; $function$
;

CREATE OR REPLACE FUNCTION public.qw10_test_commit_payment(p_request text, p_session text, p_payment text, p_amount bigint, p_currency text, p_event text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$ select qw10_test.commit_payment(p_request,p_session,p_payment,p_amount,p_currency,false,p_event); $function$
;

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

CREATE OR REPLACE FUNCTION public.qw10_test_bind(p_request text, p_owner text, p_session text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r qw10_test.requests;
begin
 if p_session is null or p_session !~ '^cs_test_[A-Za-z0-9_]+$' then raise exception 'Test session required'; end if;
 select * into r from qw10_test.requests where id=p_request and owner_id=p_owner and livemode=false for update;
 if not found or not r.hold_active or r.hold_until<=clock_timestamp() then raise exception 'Invalid test hold'; end if;
 if r.session_id is not null and r.session_id<>p_session then raise exception 'Session already bound'; end if;
 update qw10_test.requests set session_id=p_session where id=p_request;
 return true;
end; $function$
;

CREATE OR REPLACE FUNCTION public.qw10_test_prepare(p_owner text, p_session text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
end;$function$
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

CREATE OR REPLACE FUNCTION public.qw10_test_special_order_status(p_owner text, p_reference text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 with checked as materialized (select clock_timestamp() as at)
 select jsonb_build_object('environment','test','reference',r.id,'sku',r.sku,
 'requested',r.requested,'reserved',r.reserved,'additional',r.additional,
 'expiresAt',r.expires_at,'checkedAt',c.at,
 'state',case when r.expires_at<=c.at then 'expired'
 when r.reserved=0 then 'quote_only'
 when exists(select 1 from qw10_test.quote_holds h where h.reference=r.id and h.sku=r.sku and h.active and h.expires_at>c.at) then 'active'
 else 'inactive' end)
 from qw10_test.special_requests r cross join checked c
 where r.owner_id=p_owner and r.id=p_reference;
$function$
;

set check_function_bodies=on;

revoke all on all functions in schema qw10_test from public,anon,authenticated;

grant execute on all functions in schema qw10_test to service_role;

revoke all on function public.qw10_test_order_status from public,anon,authenticated;

grant execute on function public.qw10_test_order_status to service_role;

revoke all on function public.qw10_test_load_reservation from public,anon,authenticated;

grant execute on function public.qw10_test_load_reservation to service_role;

revoke all on function public.qw10_test_reserve_v2 from public,anon,authenticated;

grant execute on function public.qw10_test_reserve_v2 to service_role;

revoke all on function public.qw10_test_load_request from public,anon,authenticated;

grant execute on function public.qw10_test_load_request to service_role;

revoke all on function public.qw10_test_commit_payment from public,anon,authenticated;

grant execute on function public.qw10_test_commit_payment to service_role;

revoke all on function public.qw10_test_reserve from public,anon,authenticated;

grant execute on function public.qw10_test_reserve to service_role;

revoke all on function public.qw10_test_bind from public,anon,authenticated;

grant execute on function public.qw10_test_bind to service_role;

revoke all on function public.qw10_test_prepare from public,anon,authenticated;

grant execute on function public.qw10_test_prepare to service_role;

revoke all on function public.qw10_test_special_order from public,anon,authenticated;

grant execute on function public.qw10_test_special_order to service_role;

revoke all on function public.qw10_test_special_order_status from public,anon,authenticated;

grant execute on function public.qw10_test_special_order_status to service_role;
