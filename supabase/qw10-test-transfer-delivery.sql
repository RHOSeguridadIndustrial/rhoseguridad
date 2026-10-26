-- Only extends the owner-scoped test read model. Existing owner/ACL and invoker semantics are preserved.
create or replace function qw10_test.transfer_snapshot(p_owner text,p_request text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x."requestId"),'[]'::jsonb) from (
 select r.id as "requestId",r.total_cents as "totalCents",r.expires_at as "expiresAt",
  (not r.hold_active or r.hold_until<=clock_timestamp() or r.expires_at<=extract(epoch from clock_timestamp())) as expired,
  coalesce(p.state,'awaiting_confirmation') as state,o.id as "orderId",
  c.reference as "receiptReference",c.recorded_at as "recordedAt",
  case when exists(select 1 from qw10_test.preparation_events e where e.request_id=r.id and e.action='dispatch') then 'dispatched'
   when exists(select 1 from qw10_test.preparation_events e where e.request_id=r.id and e.action='prepare') then 'prepared'
   when o.id is not null then 'pending' else 'none' end as preparation,
  coalesce(r.quote->'lines','[]'::jsonb) as items,
  r.quote->'delivery' as delivery
 from qw10_test.requests r
 left join qw10_test.receipts p on p.request_id=r.id
 left join qw10_test.transfer_confirmations c on c.request_id=r.id
 left join qw10_test.purchase_orders o on o.request_id=r.id
 where r.owner_id=p_owner and r.livemode=false and r.quote->>'paymentMethod'='transfer'
  and (p_request is null or r.id=p_request)
 order by (p.state is null) desc,r.expires_at desc,r.id limit 100
 ) x
$$;
