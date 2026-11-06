-- Freeze the customer-confirmed recipient with the cart and retry identity.
create or replace function private.card_checkout_reserve(p_owner uuid,p_retry text,p_quote jsonb,p_identity text) returns jsonb
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
 cart:=p_identity::jsonb;
 if jsonb_typeof(cart->'contact') is distinct from 'object'
 or jsonb_typeof(cart#>'{contact,name}') is distinct from 'string'
 or length(cart#>>'{contact,name}') not between 2 and 120
 or cart#>>'{contact,name}' ~ '[[:cntrl:]<>]'
 or jsonb_typeof(cart#>'{contact,phone}') is distinct from 'string'
 or cart#>>'{contact,phone}' !~ '^\+?[0-9]{10,15}$' then raise exception 'card_invalid_contact';end if;
 select jsonb_build_object('name',cart#>>'{contact,name}','email',p.email,'phone',cart#>>'{contact,phone}') into contact
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

