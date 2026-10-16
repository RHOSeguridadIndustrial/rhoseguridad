-- Read actual catalog; reserve only isolated shadow stock.
insert into qw10_test.stock(sku,quantity,active)
 select sku,quantity,is_active and state='tracked' from public.inventory_items
 on conflict(sku) do nothing;
create function public.qw10_test_variant(p_sku text) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('sku',i.sku,'name',i.name,
   'priceCents',(p.price*100)::bigint,'active',i.is_active and p.is_active and i.state='tracked')
 from public.inventory_items i join public.products p on p.id=i.product_id
 where i.sku=p_sku and trim(p.currency)='MXN' and p.price>0 and p.price*100=trunc(p.price*100);
$$;
revoke all on function public.qw10_test_variant(text) from public,anon,authenticated;
grant execute on function public.qw10_test_variant(text) to service_role;
-- No real delivery promise: the admin-only sandbox supports fixture postal 02000.
