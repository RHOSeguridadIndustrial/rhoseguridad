-- Review draft. Isolated test orders; no live stock or messaging integration.
create table qw10_test.special_requests(
 id text primary key,owner_id text not null,retry_key text not null,
 sku text not null references qw10_test.stock(sku),requested integer not null check(requested>0),
 reserved integer not null check(reserved>=0),additional integer not null check(additional>=0),
 expires_at timestamptz not null, unique(owner_id,retry_key),check(requested=reserved+additional)
);
alter table qw10_test.special_requests enable row level security;
revoke all on qw10_test.special_requests from public,anon,authenticated;
grant select,insert on qw10_test.special_requests,qw10_test.quote_holds to service_role;
create function public.qw10_test_special_order(p_owner text,p_retry text,p_sku text,p_quantity integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
end;$$;
revoke all on function public.qw10_test_special_order(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.qw10_test_special_order(text,text,text,integer) to service_role;
