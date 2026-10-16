-- Rollback-only fixtures: no Stripe calls and no production writes.
begin;
do $$
declare q jsonb; old_hold jsonb; next_hold jsonb; outcome jsonb; n bigint;
begin
 insert into qw10_test.stock(sku,quantity,active) values('test-expiry-20261016-0555',1,true);
 q:=jsonb_build_object('currency','mxn','mode','standard','totalCents',10000,'subtotalCents',100,'shippingCents',9900,
 'lines',jsonb_build_array(jsonb_build_object('sku','test-expiry-20261016-0555','name','Prueba vencimiento','quantity',1,'unitPriceCents',100,'lineTotalCents',100)));
 old_hold:=public.qw10_test_reserve('expiry-test-owner','expiry_fixture_20261016_first',q);
 perform public.qw10_test_bind(old_hold->>'id','expiry-test-owner','cs_test_expiry_fixture_20261016');
 if (public.qw10_test_order_status('expiry-test-owner','cs_test_expiry_fixture_20261016')->>'state')<>'pending' then raise exception 'Unpaid order reported paid'; end if;
 select count(*) into n from qw10_test.purchase_orders where request_id=old_hold->>'id';
 if n<>0 then raise exception 'Unpaid reservation created order'; end if;
 update qw10_test.requests set hold_until=clock_timestamp()-interval '1 minute' where id=old_hold->>'id';
 -- A new buyer can reserve the last piece after the first hold expires.
 next_hold:=public.qw10_test_reserve('expiry-next-owner','expiry_fixture_20261016_second',q);
 if next_hold->>'id'=old_hold->>'id' then raise exception 'Expected distinct reservation'; end if;
 -- Simulate a verified late payment only at the persistence boundary.
 outcome:=public.qw10_test_commit_payment(old_hold->>'id','cs_test_expiry_fixture_20261016','pi_expiry_fixture_20261016',10000,'mxn','evt_expiry_fixture_20261016');
 if outcome->>'status'<>'reconciliation_required' or outcome->>'orderId' is not null then raise exception 'Late payment fulfilled'; end if;
 select quantity into n from qw10_test.stock where sku='test-expiry-20261016-0555';
 if n<>1 then raise exception 'Late payment changed stock'; end if;
 select count(*) into n from qw10_test.purchase_orders where request_id=old_hold->>'id';
 if n<>0 then raise exception 'Late payment created order'; end if;
 outcome:=public.qw10_test_commit_payment(old_hold->>'id','cs_test_expiry_fixture_20261016','pi_expiry_fixture_20261016',10000,'mxn','evt_expiry_fixture_repeat_20261016');
 if outcome->>'status'<>'reconciliation_required' or outcome->>'repeated'<>'true' then raise exception 'Late payment retry not idempotent'; end if;
end $$;
rollback;
select jsonb_build_object('scenario','unpaid_expired_and_late_payment','assertions','passed; rolled back',
 'remaining_fixture_rows',(select count(*) from qw10_test.stock where sku='test-expiry-20261016-0555'),
 'test_orders',(select count(*) from qw10_test.purchase_orders),
 'real_inventory',(select sum(quantity) from public.inventory_items)) result;
