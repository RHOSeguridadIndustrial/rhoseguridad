-- Read-only internal reconciliation of the authenticated administrator's test requests.
-- No bank confirmation, payment mutation, inventory mutation or historical backfill.
create function private.qw10_test_integrity()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or private.is_admin() is distinct from true then
  raise exception 'Solo administradores' using errcode='42501';
 end if;
 with records as materialized (
  select r.id as request_id,r.total_cents,r.session_id,r.quote,r.hold_active,
   case when r.quote->>'paymentMethod'='transfer' then 'transfer'
    when r.session_id is not null or r.quote->>'paymentMethod'='card' then 'card' else 'unknown' end as method,
   p.state,p.amount_cents,p.session_id as receipt_session,p.recorded_at,p.first_event_id,
   o.id as order_id,o.session_id as order_session,
   e.request_id as event_request,e.source_event,e.outcome,
   v.request_id is not null as reviewed,
   (select min(recorded_at) from qw10_test.preparation_events x where x.request_id=r.id and x.action='prepare') as prepared_at,
   (select min(recorded_at) from qw10_test.preparation_events x where x.request_id=r.id and x.action='dispatch') as dispatched_at,
   coalesce((select jsonb_agg(jsonb_build_array(l.sku,l.quantity) order by l.sku) from qw10_test.lines l where l.request_id=r.id),'[]'::jsonb) as lines,
   coalesce((select jsonb_agg(jsonb_build_array(m.sku,m.quantity) order by m.sku) from qw10_test.movements m where m.request_id=r.id),'[]'::jsonb) as movements
  from qw10_test.requests r
  left join qw10_test.receipts p on p.request_id=r.id
  left join qw10_test.purchase_orders o on o.request_id=r.id
  left join qw10_test.fulfillment_events e on e.request_id=r.id
  left join qw10_test.reconciliation_reviews v on v.request_id=r.id
  where r.owner_id=auth.uid()::text and r.livemode=false
 ), checked as materialized (
  select *,array_remove(array[
   case when state is not null and (amount_cents is distinct from total_cents or amount_cents<=0) then 'receipt_amount' end,
   case when state is not null and receipt_session is distinct from session_id then 'receipt_session' end,
   case when state='paid' and order_id is null then 'paid_without_order' end,
   case when order_id is not null and state is distinct from 'paid' then 'order_without_paid_receipt' end,
   case when order_id is not null and order_session is distinct from receipt_session then 'order_session' end,
   case when state='paid' and (lines='[]'::jsonb or lines is distinct from movements) then 'movement_mismatch' end,
   case when state is distinct from 'paid' and movements<>'[]'::jsonb then 'unpaid_movement' end,
   case when (prepared_at is not null or dispatched_at is not null) and (order_id is null or state is distinct from 'paid') then 'unpaid_preparation' end,
   case when dispatched_at is not null and (prepared_at is null or dispatched_at<prepared_at) then 'dispatch_sequence' end,
   case when state is not null and hold_active then 'paid_hold_active' end,
   case when event_request is not null and (source_event is distinct from first_event_id or outcome is distinct from state) then 'event_mismatch' end,
   case when quote is not null and quote->'totalCents' is distinct from to_jsonb(total_cents) then 'quote_total' end
  ],null) as issues,
  (state is not null and event_request is null) as legacy_evidence
  from records
 ), details as (
  select * from checked order by cardinality(issues)>0 desc,
   state='reconciliation_required' desc nulls last,recorded_at desc nulls last,request_id limit 100
 )
 select jsonb_build_object('environment','test','scope','own_requests','checkedAt',statement_timestamp(),
  'totals',(select jsonb_build_object(
   'requests',count(*),'receipts',count(state),'orders',count(order_id),
   'paid',count(*) filter(where state='paid'),
   'receiptAmountCents',coalesce(sum(amount_cents),0),
   'paidAmountCents',coalesce(sum(amount_cents) filter(where state='paid'),0),
   'review',count(*) filter(where state='reconciliation_required'),
   'reviewAmountCents',coalesce(sum(amount_cents) filter(where state='reconciliation_required'),0),
   'reviewNotes',count(*) filter(where state='reconciliation_required' and reviewed),
   'unpaid',count(*) filter(where state is null),
   'transfersWithoutReceipt',count(*) filter(where method='transfer' and state is null),
   'dispatched',count(dispatched_at),
   'inconsistent',count(*) filter(where cardinality(issues)>0),
   'legacyEvidence',count(*) filter(where legacy_evidence)) from checked),
  'detailsLimited',(select count(*)>100 from checked),
  'requests',coalesce((select jsonb_agg(jsonb_build_object(
   'requestId',request_id,'method',method,'amountCents',total_cents,
   'receiptAmountCents',amount_cents,'state',coalesce(state,'awaiting_payment'),
   'orderId',order_id,'receiptAt',recorded_at,'reviewed',reviewed,
   'preparation',case when dispatched_at is not null then 'dispatched' when prepared_at is not null then 'prepared' when order_id is not null then 'pending' else 'none' end,
   'issues',issues,'legacyEvidence',legacy_evidence)
   order by cardinality(issues)>0 desc,state='reconciliation_required' desc nulls last,recorded_at desc nulls last,request_id) from details),'[]'::jsonb)
 ) into result;
 return result;
end$$;
revoke all on function private.qw10_test_integrity() from public,anon,authenticated,service_role;
grant execute on function private.qw10_test_integrity() to authenticated;
create function public.qw10_test_integrity()
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.qw10_test_integrity()
$$;
revoke all on function public.qw10_test_integrity() from public,anon,authenticated,service_role;
grant execute on function public.qw10_test_integrity() to authenticated;
comment on function public.qw10_test_integrity() is 'Read-only internal checks of own sandbox requests. Requires current admin/MFA. Does not verify a bank or payment provider.';
