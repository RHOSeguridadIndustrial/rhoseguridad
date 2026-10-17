-- Read-only, owner-bound status for isolated special test reservations.
create function public.qw10_test_special_order_status(p_owner text,p_reference text)
returns jsonb language sql security invoker set search_path='' as $$
 with checked as materialized (select clock_timestamp() as at)
 select jsonb_build_object('environment','test','reference',r.id,'sku',r.sku,
 'requested',r.requested,'reserved',r.reserved,'additional',r.additional,
 'expiresAt',r.expires_at,'checkedAt',c.at,
 'state',case when r.expires_at<=c.at then 'expired'
 when r.reserved=0 then 'quote_only'
 when exists(select 1 from qw10_test.quote_holds h where h.reference=r.id and h.sku=r.sku and h.active and h.expires_at>c.at) then 'active'
 else 'inactive' end)
 from qw10_test.special_requests r cross join checked c
 where r.owner_id=p_owner and r.id=p_reference;
$$;
revoke all on function public.qw10_test_special_order_status(text,text) from public,anon,authenticated;
grant execute on function public.qw10_test_special_order_status(text,text) to service_role;
