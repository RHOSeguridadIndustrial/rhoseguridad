-- Sandbox only. No references to production inventory or orders.
alter table qw10_test.requests alter column session_id drop not null;
alter table qw10_test.requests add column owner_id text,
  add column retry_key text, add column quote jsonb, add column expires_at bigint;
create unique index qw10_test_owner_retry on qw10_test.requests(owner_id,retry_key);
create index qw10_test_line_sku on qw10_test.lines(sku);
create function public.qw10_test_reserve(p_owner text,p_retry text,p_quote jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
end; $$;
create function public.qw10_test_bind(p_request text,p_owner text,p_session text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r qw10_test.requests;
begin
 if p_session is null or p_session !~ '^cs_test_[A-Za-z0-9_]+$' then raise exception 'Test session required'; end if;
 select * into r from qw10_test.requests where id=p_request and owner_id=p_owner and livemode=false for update;
 if not found or not r.hold_active or r.hold_until<=clock_timestamp() then raise exception 'Invalid test hold'; end if;
 if r.session_id is not null and r.session_id<>p_session then raise exception 'Session already bound'; end if;
 update qw10_test.requests set session_id=p_session where id=p_request;
 return true;
end; $$;
revoke all on function public.qw10_test_reserve(text,text,jsonb) from public,anon,authenticated;
revoke all on function public.qw10_test_bind(text,text,text) from public,anon,authenticated;
grant execute on function public.qw10_test_reserve(text,text,jsonb) to service_role;
grant execute on function public.qw10_test_bind(text,text,text) to service_role;
grant insert on qw10_test.requests,qw10_test.lines to service_role;
