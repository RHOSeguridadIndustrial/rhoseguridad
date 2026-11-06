-- Operational card checkout. Defaults OFF; no orders or inventory are seeded.
-- Backend RPCs are invoker wrappers over narrowly granted private functions.
create table private.card_checkout_configuration (
 id boolean primary key default true check(id),
 enabled boolean not null default false,
 catalog_text text,
 pinned_sha256 text check(pinned_sha256 ~ '^[a-f0-9]{64}$')
);
insert into private.card_checkout_configuration(id) values(true);
create table private.card_checkout_requests (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 retry_key text not null check(retry_key ~ '^[a-zA-Z0-9_-]{16,100}$'),
 checkout_identity text not null,
 quote jsonb not null,
 contact jsonb not null,
 total_cents bigint not null check(total_cents between 1 and 99999999),
 expires_at bigint not null,
 hold_active boolean not null default true,
 session_id text unique check(session_id ~ '^cs_live_[A-Za-z0-9_]{1,240}$'),
 state text not null default 'prepared' check(state in ('prepared','paid','reconciliation_required')),
 order_id uuid unique references public.orders(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(owner_id,retry_key)
);
create index card_checkout_owner_created on private.card_checkout_requests(owner_id,created_at desc);
create index card_checkout_active_expiry on private.card_checkout_requests(expires_at) where hold_active;
create table private.card_checkout_lines (
 request_id uuid not null references private.card_checkout_requests(id),
 sku text not null references public.inventory_items(sku),
 product_id text not null references public.products(id),
 name text not null,
 quantity integer not null check(quantity between 1 and 100),
 unit_cents bigint not null check(unit_cents>0),
 primary key(request_id,sku)
);
create index card_checkout_lines_sku on private.card_checkout_lines(sku);
create table private.card_payment_receipts (
 id uuid primary key default gen_random_uuid(),
 request_id uuid not null unique references private.card_checkout_requests(id),
 session_id text not null unique check(session_id ~ '^cs_live_[A-Za-z0-9_]{1,240}$'),
 payment_intent_id text not null unique check(payment_intent_id ~ '^pi_[A-Za-z0-9_]{1,250}$'),
 first_event_id text not null unique check(first_event_id ~ '^evt_[A-Za-z0-9_]{1,250}$'),
 amount_cents bigint not null check(amount_cents>0),
 currency text not null check(currency='mxn'),
 outcome text not null check(outcome in ('paid','reconciliation_required')),
 reason text check(reason in ('reservation_expired','reservation_inactive','stock_unavailable')),
 created_at timestamptz not null default clock_timestamp(),
 check((outcome='paid' and reason is null) or (outcome='reconciliation_required' and reason is not null))
);
-- Transaction-local authorization evidence, never a caller-controlled GUC or UUID.
-- Rows are created and deleted inside commit_card_payment, in the same transaction.
create table private.card_inventory_write_context (
 transaction_id bigint not null,
 sku text not null references public.inventory_items(sku),
 receipt_id uuid not null references private.card_payment_receipts(id),
 old_quantity integer not null,
 new_quantity integer not null,
 old_revision integer not null,
 primary key(transaction_id,sku)
);
alter table private.card_checkout_configuration enable row level security;
alter table private.card_checkout_requests enable row level security;
alter table private.card_checkout_lines enable row level security;
alter table private.card_payment_receipts enable row level security;
alter table private.card_inventory_write_context enable row level security;
revoke all on private.card_checkout_configuration,private.card_checkout_requests,
 private.card_checkout_lines,private.card_payment_receipts,private.card_inventory_write_context
 from public,anon,authenticated,service_role;

alter table public.inventory_history alter column changed_by drop not null;
alter table public.inventory_history add column card_receipt_id uuid references private.card_payment_receipts(id);
alter table public.inventory_history add constraint inventory_history_actor_identity
 check((changed_by is not null and card_receipt_id is null) or (changed_by is null and card_receipt_id is not null));
create unique index inventory_history_card_receipt_sku on public.inventory_history(card_receipt_id,sku)
 where card_receipt_id is not null;

-- Private privileged access is limited by EXECUTE grants below. Never exposed
-- directly through PostgREST; public wrappers retain SECURITY INVOKER.
create function private.card_checkout_identity() returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
 -- Established active-account, confirmed-email, revoked-session and admin MFA checks.
 return private.transfer_request_identity();
end $$;

create function private.card_checkout_snapshot(r private.card_checkout_requests) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',r.id,'ownerId',r.owner_id,'retryKey',r.retry_key,
 'checkoutIdentity',r.checkout_identity,'quote',r.quote,'expiresAt',r.expires_at,
 'environment','live','livemode',true,'integrationVersion','card-checkout-v1',
 'sessionId',r.session_id,'totalCents',r.total_cents)
$$;
create function private.card_checkout_config() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',enabled,'catalogText',catalog_text,'pinnedSha256',pinned_sha256)
 from private.card_checkout_configuration where id
$$;
create function private.card_checkout_variant(p_sku text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('sku',i.sku,'name',i.name,'priceCents',(p.price*100)::bigint,
 'active',i.is_active and p.is_active and i.state='tracked')
 from public.inventory_items i join public.products p on p.id=i.product_id
 where i.sku=p_sku and p.currency='MXN' and p.price>0 and p.price*100=trunc(p.price*100)
$$;
create function private.card_checkout_load(p_owner uuid,p_retry text) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.card_checkout_snapshot(r) from private.card_checkout_requests r
 where r.owner_id=p_owner and r.retry_key=p_retry
$$;

-- Manual quotes and card checkout share the same physical SKU locks and floor.
create or replace function private.inventory_reserved(p_sku text) returns bigint
language sql volatile security definer set search_path='' as $$
 select coalesce((select sum(l.quantity) from private.inventory_reservation_lines l
 join private.inventory_reservations r using(reference)
 where l.sku=p_sku and r.status='active' and r.expires_at>clock_timestamp()),0)
 +coalesce((select sum(l.quantity) from private.card_checkout_lines l
 join private.card_checkout_requests r on r.id=l.request_id
 where l.sku=p_sku and r.hold_active and r.expires_at>extract(epoch from clock_timestamp())),0)
$$;

create function private.card_checkout_reserve(p_owner uuid,p_retry text,p_quote jsonb,p_identity text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.card_checkout_requests; entry jsonb; cart jsonb; price record;
 subtotal bigint:=0; shipping bigint; contact jsonb; catalog_digest text;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'card_fresh_transaction_required';end if;
 select pinned_sha256 into catalog_digest from private.card_checkout_configuration where id and enabled;
 if not found then raise exception 'card_checkout_disabled';end if;
 if p_owner is null or p_retry is null or p_retry !~ '^[a-zA-Z0-9_-]{16,100}$'
 or p_identity is null or octet_length(p_identity)>20000
 or jsonb_typeof(p_quote) is distinct from 'object' or octet_length(p_quote::text)>100000 then
  raise exception 'card_invalid_request';end if;
 -- One account lock serializes retry creation and limits, before sorted SKU locks.
 perform pg_advisory_xact_lock(hashtextextended('card-checkout:'||p_owner::text,0));
 select * into r from private.card_checkout_requests where owner_id=p_owner and retry_key=p_retry;
 if found then
  if r.checkout_identity<>p_identity then raise exception 'card_retry_changed';end if;
  return private.card_checkout_snapshot(r);
 end if;
 select jsonb_build_object('name',p.full_name,'email',p.email,'phone',p.phone) into contact
 from public.profiles p join auth.users u on u.id=p.id where p.id=p_owner and p.deactivated_at is null
 and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false)
 and (u.banned_until is null or u.banned_until<=clock_timestamp());
 if not found then raise exception 'card_account_disabled' using errcode='42501';end if;
 if (select count(*) from private.card_checkout_requests where owner_id=p_owner
   and created_at>clock_timestamp()-interval '1 hour')>=10 then raise exception 'card_rate_limit';end if;
 cart:=p_identity::jsonb;
 if cart->>'paymentMethod' is distinct from 'card' or p_quote->>'paymentMethod' is distinct from 'card'
 or p_quote->>'currency' is distinct from 'mxn' or jsonb_typeof(p_quote->'lines') is distinct from 'array'
 or jsonb_array_length(p_quote->'lines') not between 1 and 100
 or p_quote#>>'{delivery,status}' is distinct from 'postal_match'
 or p_quote#>>'{delivery,assurance}' is distinct from 'postal_catalog_only'
 or catalog_digest is null or p_quote#>>'{delivery,catalogSha256}' is distinct from catalog_digest
 or jsonb_typeof(cart->'address') is distinct from 'object'
 or cart#>>'{address,country}' is distinct from 'MX' or cart#>>'{address,state}' is distinct from 'CMX'
 or ((p_quote#>'{delivery,address}') - 'municipality' - 'settlement') is distinct from cart->'address'
 or (p_quote#>>'{delivery,validUntil}') is null
 or (p_quote#>>'{delivery,validUntil}')::timestamptz<=clock_timestamp() then raise exception 'card_invalid_quote';end if;
 if exists(select 1 from jsonb_array_elements(p_quote->'lines') l where jsonb_typeof(l) is distinct from 'object'
  or l->>'sku' is null or l->>'sku' !~ '^[a-z0-9][a-z0-9-]{1,119}$'
  or jsonb_typeof(l->'quantity') is distinct from 'number' or l->>'quantity' !~ '^[1-9][0-9]{0,2}$'
  or (l->>'quantity')::int>100) then raise exception 'card_invalid_lines';end if;
 if (select count(distinct l->>'sku') from jsonb_array_elements(p_quote->'lines') l)<>jsonb_array_length(p_quote->'lines')
 or (select jsonb_agg(jsonb_build_object('sku',l->>'sku','quantity',(l->>'quantity')::int) order by l->>'sku')
  from jsonb_array_elements(p_quote->'lines') l) is distinct from cart->'items' then raise exception 'card_cart_mismatch';end if;
 perform 1 from public.inventory_items where sku in(select l->>'sku' from jsonb_array_elements(p_quote->'lines') l)
 order by sku for update;
 perform 1 from public.products where id in(select product_id from public.inventory_items
 where sku in(select l->>'sku' from jsonb_array_elements(p_quote->'lines') l)) order by id for share;
 for entry in select value from jsonb_array_elements(p_quote->'lines') loop
  select i.*,p.price,p.currency,p.is_active as price_active into price
  from public.inventory_items i join public.products p on p.id=i.product_id where i.sku=entry->>'sku';
  if not found or not price.is_active or not price.price_active or price.state<>'tracked'
  or price.currency<>'MXN' or price.price<=0 or price.price*100<>trunc(price.price*100)
  or price.quantity-private.inventory_reserved(price.sku)<(entry->>'quantity')::int
  then raise exception 'card_availability_changed';end if;
  if entry->>'name' is distinct from price.name or jsonb_typeof(entry->'unitPriceCents') is distinct from 'number'
  or (entry->>'unitPriceCents')::numeric is distinct from price.price*100
  or jsonb_typeof(entry->'lineTotalCents') is distinct from 'number'
  or (entry->>'lineTotalCents')::numeric is distinct from price.price*100*(entry->>'quantity')::int
  then raise exception 'card_price_changed';end if;
  subtotal:=subtotal+(price.price*100)::bigint*(entry->>'quantity')::int;
 end loop;
 shipping:=case when subtotal<29900 then 9900 else 0 end;
 if jsonb_typeof(p_quote->'subtotalCents') is distinct from 'number' or (p_quote->>'subtotalCents')::numeric is distinct from subtotal
 or jsonb_typeof(p_quote->'shippingCents') is distinct from 'number' or (p_quote->>'shippingCents')::numeric is distinct from shipping
 or jsonb_typeof(p_quote->'totalCents') is distinct from 'number' or (p_quote->>'totalCents')::numeric is distinct from subtotal+shipping
 or p_quote->>'mode' is distinct from (case when subtotal>120000 then 'express' else 'standard' end)
 then raise exception 'card_total_changed';end if;
 -- Deadline starts after locks/validation; immutable for all retries to Stripe.
 insert into private.card_checkout_requests(owner_id,retry_key,checkout_identity,quote,contact,total_cents,expires_at)
 values(p_owner,p_retry,p_identity,p_quote,contact,subtotal+shipping,floor(extract(epoch from clock_timestamp()))::bigint+3600)
 returning * into r;
 insert into private.card_checkout_lines(request_id,sku,product_id,name,quantity,unit_cents)
 select r.id,i.sku,i.product_id,l->>'name',(l->>'quantity')::int,(l->>'unitPriceCents')::bigint
 from jsonb_array_elements(p_quote->'lines') l join public.inventory_items i on i.sku=l->>'sku';
 return private.card_checkout_snapshot(r);
end $$;

create function private.card_checkout_bind(p_request uuid,p_owner uuid,p_session text) returns void
language plpgsql security definer set search_path='' as $$
declare r private.card_checkout_requests;
begin
 if p_session is null or p_session !~ '^cs_live_[A-Za-z0-9_]{1,240}$' then raise exception 'card_invalid_session';end if;
 select * into r from private.card_checkout_requests where id=p_request and owner_id=p_owner for update;
 if not found or (r.session_id is not null and r.session_id<>p_session) then raise exception 'card_binding_conflict';end if;
 -- A Stripe response may arrive after hold expiry; keep its binding so a paid
 -- notification is recorded for reconciliation instead of becoming untraceable.
 if r.session_id is null then update private.card_checkout_requests set session_id=p_session where id=p_request;end if;
end $$;
create function private.card_checkout_load_payment(p_session text) returns jsonb
language sql stable security definer set search_path='' as $$
 select private.card_checkout_snapshot(r) from private.card_checkout_requests r where r.session_id=p_session
$$;

create function private.card_inventory_receipt(old_row public.inventory_items,new_row public.inventory_items) returns uuid
language sql volatile security definer set search_path='' as $$
 select c.receipt_id from private.card_inventory_write_context c
 join private.card_payment_receipts r on r.id=c.receipt_id
 join private.card_checkout_lines l on l.request_id=r.request_id and l.sku=c.sku
 where auth.uid() is null and c.transaction_id=txid_current() and c.sku=old_row.sku
 and r.outcome='paid' and c.old_quantity=old_row.quantity and c.new_quantity=new_row.quantity
 and c.old_revision=old_row.revision and new_row.quantity=old_row.quantity-l.quantity
 and (to_jsonb(old_row)-'quantity'-'revision'-'updated_at')=(to_jsonb(new_row)-'quantity'-'revision'-'updated_at')
$$;
create or replace function private.inventory_before_write() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and private.card_inventory_receipt(old,new) is not null then
  new.revision:=old.revision+1;new.updated_at:=clock_timestamp();return new;
 end if;
 if auth.uid() is null or not private.is_admin() then raise exception 'Solo administradores' using errcode='42501';end if;
 if length(btrim(coalesce(current_setting('rho.inventory_reason',true),'')))<3 then raise exception 'Indica el motivo del movimiento';end if;
 if tg_op='UPDATE' then
  if new.sku<>old.sku or new.product_id<>old.product_id then raise exception 'No se puede cambiar la identidad del artículo';end if;
  new.revision:=old.revision+1;
 else new.revision:=1;end if;
 new.updated_at:=clock_timestamp();return new;
end $$;
create or replace function private.inventory_reservation_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare held bigint;
begin
 if private.card_inventory_receipt(old,new) is null and (auth.uid() is null or not private.is_admin())
 then raise exception 'Solo administradores' using errcode='42501';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Vuelve a intentar el movimiento en una transacción nueva';end if;
 held:=private.inventory_reserved(old.sku);
 if held>0 and (new.quantity<held or not new.is_active or new.state<>'tracked') then
 raise exception 'Hay piezas reservadas. Cancela la reserva antes de registrar la salida o modificar las existencias.';end if;
 return new;
end $$;
create or replace function private.inventory_audit() returns trigger
language plpgsql security definer set search_path='' as $$
declare receipt uuid;
begin
 if tg_op='UPDATE' then receipt:=private.card_inventory_receipt(old,new);end if;
 if receipt is null and (auth.uid() is null or not private.is_admin()) then
  raise exception 'Solo administradores' using errcode='42501';end if;
 insert into public.inventory_history(sku,old_quantity,new_quantity,old_state,new_state,old_details,new_details,reason,changed_by,card_receipt_id)
 values(new.sku,case when tg_op='UPDATE' then old.quantity end,new.quantity,case when tg_op='UPDATE' then old.state end,new.state,
 case when tg_op='UPDATE' then jsonb_build_object('minimum_stock',old.minimum_stock,'unit',old.unit,'is_active',old.is_active,'name',old.name) end,
 jsonb_build_object('minimum_stock',new.minimum_stock,'unit',new.unit,'is_active',new.is_active,'name',new.name),
 case when receipt is not null then 'Pago con tarjeta confirmado: '||receipt::text else btrim(current_setting('rho.inventory_reason',true)) end,
 case when receipt is null then auth.uid() end,receipt);
 return new;
end $$;

create function private.card_checkout_commit(p_request uuid,p_session text,p_payment text,p_amount bigint,p_currency text,p_event text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r private.card_checkout_requests; receipt private.card_payment_receipts; why text; order_uuid uuid;
begin
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'card_fresh_transaction_required';end if;
 -- The service-role webhook has no human subject. Never attribute it to a user.
 if auth.uid() is not null then raise exception 'card_service_identity_required' using errcode='42501';end if;
 if p_session is null or p_session !~ '^cs_live_[A-Za-z0-9_]{1,240}$'
 or p_payment is null or p_payment !~ '^pi_[A-Za-z0-9_]{1,250}$'
 or p_event is null or p_event !~ '^evt_[A-Za-z0-9_]{1,250}$' then raise exception 'card_invalid_payment';end if;
 select * into r from private.card_checkout_requests where id=p_request for update;
 if not found or r.session_id is distinct from p_session or r.total_cents is distinct from p_amount
 or p_currency is distinct from 'mxn' then raise exception 'card_payment_mismatch';end if;
 select * into receipt from private.card_payment_receipts where request_id=r.id;
 if found then
  if receipt.payment_intent_id<>p_payment or receipt.session_id<>p_session or receipt.amount_cents<>p_amount
  then raise exception 'card_payment_retry_conflict';end if;
  return jsonb_build_object('status',receipt.outcome,'orderId',r.order_id,'repeated',true);
 end if;
 perform 1 from public.inventory_items i join private.card_checkout_lines l on l.sku=i.sku
 where l.request_id=r.id order by i.sku for update of i;
 -- Check expiry AFTER the stock-lock wait. Other holds remain protected.
 if not r.hold_active then why:='reservation_inactive';
 elsif r.expires_at<=extract(epoch from clock_timestamp()) then why:='reservation_expired';end if;
 update private.card_checkout_requests set hold_active=false where id=r.id;
 if why is null and (not exists(select 1 from private.card_checkout_lines where request_id=r.id)
 or exists(select 1 from private.card_checkout_lines l join public.inventory_items i on i.sku=l.sku
 where l.request_id=r.id and (not i.is_active or i.state<>'tracked' or i.quantity-l.quantity<private.inventory_reserved(i.sku))))
 then why:='stock_unavailable';end if;
 insert into private.card_payment_receipts(request_id,session_id,payment_intent_id,first_event_id,amount_cents,currency,outcome,reason)
 values(r.id,p_session,p_payment,p_event,p_amount,p_currency,case when why is null then 'paid' else 'reconciliation_required' end,why)
 returning * into receipt;
 if why is null then
  insert into public.orders(checkout_session_id,payment_intent_id,status,customer_email,customer_name,amount_total,currency,paid_at)
  values(p_session,p_payment,'paid',r.contact->>'email',r.contact->>'name',p_amount::numeric/100,'MXN',clock_timestamp()) returning id into order_uuid;
  insert into public.order_items(order_id,product_id,product_name,requested_item_id,quantity,unit_price,line_total)
  select order_uuid,product_id,name,sku,quantity,unit_cents::numeric/100,unit_cents::numeric*quantity/100
  from private.card_checkout_lines where request_id=r.id;
  insert into private.card_inventory_write_context(transaction_id,sku,receipt_id,old_quantity,new_quantity,old_revision)
  select txid_current(),i.sku,receipt.id,i.quantity,i.quantity-l.quantity,i.revision
  from public.inventory_items i join private.card_checkout_lines l on l.sku=i.sku where l.request_id=r.id;
  update public.inventory_items i set quantity=i.quantity-l.quantity
  from private.card_checkout_lines l where l.request_id=r.id and l.sku=i.sku;
  delete from private.card_inventory_write_context where transaction_id=txid_current() and receipt_id=receipt.id;
 end if;
 update private.card_checkout_requests set state=receipt.outcome,order_id=order_uuid where id=r.id;
 return jsonb_build_object('status',receipt.outcome,'orderId',order_uuid,'repeated',false);
end $$;

create function private.card_checkout_status(p_session text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner uuid:=private.card_checkout_identity();r private.card_checkout_requests;
begin
 select * into r from private.card_checkout_requests where owner_id=owner and session_id=p_session;
 if not found then return null;end if;
 return jsonb_build_object('requestId',r.id,'orderId',r.order_id,'state',case when r.state='prepared'
 and r.expires_at<=extract(epoch from now()) then 'expired' else r.state end,
 'paymentStatus',case when r.state in ('paid','reconciliation_required') then 'paid' else 'unconfirmed' end,
 'totalCents',r.total_cents,'currency','mxn','quote',r.quote,'createdAt',r.created_at);
end $$;

-- Explicit revocations cover Supabase default privileges, including service_role.
revoke all on function private.card_checkout_identity(),private.card_checkout_snapshot(private.card_checkout_requests),
 private.card_checkout_config(),private.card_checkout_variant(text),private.card_checkout_load(uuid,text),
 private.card_checkout_reserve(uuid,text,jsonb,text),private.card_checkout_bind(uuid,uuid,text),
 private.card_checkout_load_payment(text),private.card_checkout_commit(uuid,text,text,bigint,text,text),
 private.card_checkout_status(text),private.card_inventory_receipt(public.inventory_items,public.inventory_items)
 from public,anon,authenticated,service_role;
grant usage on schema private to authenticated,service_role;
grant execute on function private.card_checkout_identity(),private.card_checkout_status(text) to authenticated;
-- Read-only transaction evidence is needed by the existing invoker trigger.
grant execute on function private.card_inventory_receipt(public.inventory_items,public.inventory_items) to authenticated;
grant execute on function private.card_checkout_config(),private.card_checkout_variant(text),private.card_checkout_load(uuid,text),
 private.card_checkout_reserve(uuid,text,jsonb,text),private.card_checkout_bind(uuid,uuid,text),
 private.card_checkout_load_payment(text),private.card_checkout_commit(uuid,text,text,bigint,text,text) to service_role;

create function public.card_checkout_identity() returns uuid language sql stable security invoker set search_path='' as $$select private.card_checkout_identity()$$;
create function public.card_checkout_status(p_session text) returns jsonb language sql stable security invoker set search_path='' as $$select private.card_checkout_status(p_session)$$;
create function public.card_checkout_config() returns jsonb language sql stable security invoker set search_path='' as $$select private.card_checkout_config()$$;
create function public.card_checkout_variant(p_sku text) returns jsonb language sql stable security invoker set search_path='' as $$select private.card_checkout_variant(p_sku)$$;
create function public.card_checkout_load(p_owner uuid,p_retry text) returns jsonb language sql stable security invoker set search_path='' as $$select private.card_checkout_load(p_owner,p_retry)$$;
create function public.card_checkout_reserve(p_owner uuid,p_retry text,p_quote jsonb,p_identity text) returns jsonb language sql security invoker set search_path='' as $$select private.card_checkout_reserve(p_owner,p_retry,p_quote,p_identity)$$;
create function public.card_checkout_bind(p_request uuid,p_owner uuid,p_session text) returns void language sql security invoker set search_path='' as $$select private.card_checkout_bind(p_request,p_owner,p_session)$$;
create function public.card_checkout_load_payment(p_session text) returns jsonb language sql stable security invoker set search_path='' as $$select private.card_checkout_load_payment(p_session)$$;
create function public.card_checkout_commit(p_request uuid,p_session text,p_payment text,p_amount bigint,p_currency text,p_event text) returns jsonb language sql security invoker set search_path='' as $$select private.card_checkout_commit(p_request,p_session,p_payment,p_amount,p_currency,p_event)$$;
revoke all on function public.card_checkout_identity(),public.card_checkout_status(text),public.card_checkout_config(),public.card_checkout_variant(text),
 public.card_checkout_load(uuid,text),public.card_checkout_reserve(uuid,text,jsonb,text),public.card_checkout_bind(uuid,uuid,text),
 public.card_checkout_load_payment(text),public.card_checkout_commit(uuid,text,text,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.card_checkout_identity(),public.card_checkout_status(text) to authenticated;
grant execute on function public.card_checkout_config(),public.card_checkout_variant(text),public.card_checkout_load(uuid,text),
 public.card_checkout_reserve(uuid,text,jsonb,text),public.card_checkout_bind(uuid,uuid,text),
 public.card_checkout_load_payment(text),public.card_checkout_commit(uuid,text,text,bigint,text,text) to service_role;
notify pgrst,'reload schema';
