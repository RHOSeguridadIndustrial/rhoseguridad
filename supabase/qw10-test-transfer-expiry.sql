-- A closed, unpaid transfer fixture can be replaced explicitly by its owner.
-- Card/unknown outcomes retain their retry key for reconciliation.
begin;
create or replace function public.qw10_test_load_reservation(p_owner text, p_retry text)
returns jsonb language plpgsql security invoker set search_path to '' as $function$
declare r qw10_test.requests; checked_at timestamptz := clock_timestamp();
begin
 if p_owner is null or length(p_owner) not between 1 and 120 or
    p_retry is null or p_retry !~ '^[A-Za-z0-9_-]{16,100}$' then
   raise exception 'Invalid checkout identity';
 end if;
 select * into r from qw10_test.requests where owner_id=p_owner and retry_key=p_retry;
 if not found then return null; end if;
 if r.checkout_identity is not null and r.livemode=false and r.hold_active
    and r.hold_until<=checked_at and r.expires_at<=extract(epoch from checked_at)
    and r.session_id is null and r.quote->>'paymentMethod'='transfer'
    and r.checkout_identity::jsonb->>'paymentMethod'='transfer'
    and not exists(select 1 from qw10_test.receipts where request_id=r.id)
    and not exists(select 1 from qw10_test.purchase_orders where request_id=r.id)
    and not exists(select 1 from qw10_test.movements where request_id=r.id) then
   raise exception using errcode='PQT01', message='Expired unpaid test transfer';
 end if;
 if r.checkout_identity is null or r.livemode is distinct from false or
    not r.hold_active or r.hold_until<=checked_at or r.expires_at is null or
    r.expires_at<=extract(epoch from checked_at) then
   raise exception 'Unavailable saved test reservation';
 end if;
 return jsonb_build_object('id',r.id,'ownerId',r.owner_id,'retryKey',r.retry_key,
   'checkoutIdentity',r.checkout_identity,'quote',r.quote,'expiresAt',r.expires_at,'livemode',false);
end; $function$;
-- CREATE OR REPLACE preserves the existing service-only execution privileges.
commit;
