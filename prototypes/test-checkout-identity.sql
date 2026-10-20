-- LOCAL REVIEW DRAFT ONLY. Never apply automatically to production.
-- Extends the isolated qw10_test ledger; no real inventory references.
alter table qw10_test.requests add column checkout_identity text;

create function public.qw10_test_load_reservation(p_owner text,p_retry text)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
end; $$;

create function public.qw10_test_reserve_v2(p_owner text,p_retry text,p_quote jsonb,p_identity text)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
end; $$;
revoke all on function public.qw10_test_load_reservation(text,text) from public,anon,authenticated;
revoke all on function public.qw10_test_reserve_v2(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.qw10_test_load_reservation(text,text) to service_role;
grant execute on function public.qw10_test_reserve_v2(text,text,jsonb,text) to service_role;
grant update(checkout_identity) on qw10_test.requests to service_role;
