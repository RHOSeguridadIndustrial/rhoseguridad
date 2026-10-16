-- Draft: read-only, isolated test status. No production orders or stock access.
create or replace function public.qw10_test_order_status(p_owner text,p_session text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('environment','test','state',
   case when p.state='paid' and o.id is not null then 'paid'
        when p.state='reconciliation_required' then 'reconciliation_required'
        else 'pending' end,
   'orderId',case when p.state='paid' then o.id::text else null end,
   'quote',r.quote)
 from qw10_test.requests r
 left join qw10_test.receipts p on p.request_id=r.id
 left join qw10_test.purchase_orders o on o.request_id=r.id
 where r.owner_id=p_owner and r.session_id=p_session and r.livemode=false
 and p_session like 'cs_test_%';
$$;
revoke all on function public.qw10_test_order_status(text,text) from public,anon,authenticated;
grant execute on function public.qw10_test_order_status(text,text) to service_role;
