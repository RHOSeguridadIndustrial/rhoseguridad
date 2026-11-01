-- Purchase requests only. This migration never writes orders, stock or payments.
create table private.transfer_purchase_requests (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id),
  request_key uuid not null,
  submitted jsonb not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(owner_id, request_key)
);
create index transfer_purchase_requests_owner_created on private.transfer_purchase_requests(owner_id,created_at desc);
create index transfer_purchase_requests_created on private.transfer_purchase_requests(created_at desc,id desc);
alter table private.transfer_purchase_requests enable row level security;
revoke all on private.transfer_purchase_requests from public,anon,authenticated,service_role;
revoke all on sequence private.transfer_purchase_requests_id_seq from public,anon,authenticated,service_role;

create function private.transfer_request_identity() returns uuid
language plpgsql stable security definer set search_path='' as $$
declare caller uuid := auth.uid();
begin
  if caller is null or private.customer_account_enabled() is distinct from true
    or not exists(select 1 from auth.users u where u.id=caller and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous,false)=false and (u.banned_until is null or u.banned_until<=now()))
    or not exists(select 1 from auth.sessions s where s.user_id=caller
      and s.id::text=auth.jwt()->>'session_id' and (s.not_after is null or s.not_after>now()))
    or (private.current_user_is_admin() and private.is_admin() is distinct from true) then
    raise exception 'transfer_auth_required' using errcode='42501';
  end if;
  return caller;
end; $$;
revoke all on function private.transfer_request_identity() from public,anon,authenticated,service_role;

create function private.transfer_request_receipt(r private.transfer_purchase_requests) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('reference','SOL-'||lpad(r.id::text,10,'0'),
  'status','awaiting_review','payment_status','unconfirmed','created_at',r.created_at,
  'contact',r.submitted->'contact','items',r.snapshot->'items',
  'products_cents',r.snapshot->'products_cents','shipping_cents',null,'total_cents',null);
$$;
revoke all on function private.transfer_request_receipt(private.transfer_purchase_requests) from public,anon,authenticated,service_role;

create function private.submit_transfer_request(p_key uuid,p_contact jsonb,p_items jsonb,p_expected_cents bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 caller uuid:=private.transfer_request_identity(); prior private.transfer_purchase_requests;
 canonical jsonb; entry jsonb; product record; lines jsonb:='[]'; total bigint:=0; qty integer;
 field text; maxlen integer; contact jsonb:='{}';
begin
 if p_key is null or jsonb_typeof(p_contact) is distinct from 'object'
   or octet_length(p_contact::text)>6000 or jsonb_typeof(p_items) is distinct from 'array'
   or octet_length(p_items::text)>30000
   or jsonb_array_length(p_items) not between 1 and 100 or p_expected_cents is null or p_expected_cents<1 then
   raise exception 'transfer_invalid_request';
 end if;
 for field,maxlen in select * from (values ('name',100),('phone',25),('email',160),('company',120),
   ('postal',5),('state',80),('municipality',100),('settlement',150),('street',120),
   ('exterior',20),('interior',20),('notes',240),('destination',5)) as fields(k,n) loop
   if jsonb_typeof(p_contact->field) is distinct from 'string' or length(p_contact->>field)>maxlen then
     raise exception 'transfer_invalid_contact';
   end if;
   contact:=contact||jsonb_build_object(field,btrim(p_contact->>field));
 end loop;
 if jsonb_typeof(p_contact->'invoice') is distinct from 'boolean' then raise exception 'transfer_invalid_contact'; end if;
 contact:=contact||jsonb_build_object('invoice',p_contact->'invoice');
 if length(contact->>'name')<2
   or regexp_replace(contact->>'phone','[[:space:]()+.-]','','g') !~ '^(52)?[0-9]{10}$'
   or (contact->>'email'<>'' and contact->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
   or contact->>'postal' !~ '^[0-9]{5}$' or contact->>'destination' not in ('cdmx','other') then
   raise exception 'transfer_invalid_contact';
 end if;
 if contact->>'destination'='cdmx' then
   if (contact->>'postal')::int not between 1000 and 16999 then raise exception 'transfer_invalid_contact'; end if;
   contact:=contact||jsonb_build_object('state','Ciudad de México');
 end if;
 foreach field in array array['state','municipality','settlement','street','exterior'] loop
   if contact->>field='' then raise exception 'transfer_invalid_contact'; end if;
 end loop;
 for entry in select value from jsonb_array_elements(p_items) loop
   if jsonb_typeof(entry) is distinct from 'object' or jsonb_typeof(entry->'sku') is distinct from 'string'
     or length(entry->>'sku') not between 1 and 150 or jsonb_typeof(entry->'quantity') is distinct from 'number'
     or (entry->>'quantity') !~ '^[1-9][0-9]{0,3}$' then raise exception 'transfer_invalid_items'; end if;
 end loop;
 if (select count(distinct value->>'sku') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then
   raise exception 'transfer_duplicate_sku';
 end if;
 select jsonb_build_object('contact',contact,'expected_cents',p_expected_cents,'items',
   jsonb_agg(jsonb_build_object('sku',value->>'sku','quantity',(value->>'quantity')::int) order by value->>'sku'))
 into canonical from jsonb_array_elements(p_items);
 -- Serialize per account: retries and limits stay correct under concurrent requests.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('transfer-request:'||caller::text,0));
 select * into prior from private.transfer_purchase_requests where owner_id=caller and request_key=p_key;
 if found then
   if prior.submitted<>canonical then raise exception 'transfer_request_conflict'; end if;
   return private.transfer_request_receipt(prior);
 end if;
 if (select count(*) from private.transfer_purchase_requests where owner_id=caller and created_at>now()-interval '1 hour')>=10 then
   raise exception 'transfer_rate_limit';
 end if;
 for entry in select value from jsonb_array_elements(canonical->'items') loop
   qty:=(entry->>'quantity')::int;
   select i.sku,i.name,i.unit,i.quantity,i.state,i.is_active as stock_active,
     p.price,p.currency,p.is_active as price_active into product
   from public.inventory_items i join public.products p on p.id=i.product_id where i.sku=entry->>'sku';
   if not found or product.sku='chaleco-seguridad' or product.stock_active is distinct from true
     or product.price_active is distinct from true or product.currency is distinct from 'MXN'
     or product.price is null or product.price<=0 or product.price*100<>trunc(product.price*100)
     or product.price>10000000 or product.state not in ('tracked','pending')
     or product.state is null or product.quantity is null or product.quantity<qty then
     raise exception 'transfer_availability_changed';
   end if;
   total:=total+(product.price*100)::bigint*qty;
   lines:=lines||jsonb_build_array(jsonb_build_object('sku',product.sku,'name',product.name,'unit',product.unit,
     'quantity',qty,'unit_cents',(product.price*100)::bigint,'amount_cents',(product.price*100)::bigint*qty));
 end loop;
 if total<>p_expected_cents then raise exception 'transfer_price_changed'; end if;
 insert into private.transfer_purchase_requests(owner_id,request_key,submitted,snapshot)
 values(caller,p_key,canonical,jsonb_build_object('items',lines,'products_cents',total)) returning * into prior;
 return private.transfer_request_receipt(prior);
end; $$;
revoke all on function private.submit_transfer_request(uuid,jsonb,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function private.submit_transfer_request(uuid,jsonb,jsonb,bigint) to authenticated;
create function public.submit_transfer_request(p_key uuid,p_contact jsonb,p_items jsonb,p_expected_cents bigint) returns jsonb
language sql security invoker set search_path='' as $$ select private.submit_transfer_request(p_key,p_contact,p_items,p_expected_cents); $$;
revoke all on function public.submit_transfer_request(uuid,jsonb,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.submit_transfer_request(uuid,jsonb,jsonb,bigint) to authenticated;

create function private.list_transfer_requests(p_admin boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=private.transfer_request_identity(); result jsonb;
begin
 if p_admin is null or (p_admin and private.is_admin() is distinct from true) then
   raise exception 'transfer_admin_required' using errcode='42501';
 end if;
 select coalesce(jsonb_agg(private.transfer_request_receipt(r) order by r.created_at desc,r.id desc),'[]'::jsonb)
 into result from (select t.* from private.transfer_purchase_requests t
   where p_admin or t.owner_id=caller order by t.created_at desc,t.id desc limit 50) r;
 return jsonb_build_object('requests',result,'limit',50);
end; $$;
revoke all on function private.list_transfer_requests(boolean) from public,anon,authenticated,service_role;
grant execute on function private.list_transfer_requests(boolean) to authenticated;
create function public.list_transfer_requests(p_admin boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$ select private.list_transfer_requests(p_admin); $$;
revoke all on function public.list_transfer_requests(boolean) from public,anon,authenticated,service_role;
grant execute on function public.list_transfer_requests(boolean) to authenticated;
