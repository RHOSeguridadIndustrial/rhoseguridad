-- ONLY for exported disposable integration fixture. No remote deployment.
do $$begin if to_regclass('qw10_actor_lab.only_synthetic_data') is null then raise exception 'Disposable fixture required';end if;end$$;
alter table consumption_lab.requests add column hold_until timestamptz not null default clock_timestamp()+interval '30 minutes';
create table consumption_lab.reconciliation(request_id text primary key references consumption_lab.requests,receipt_id text not null references consumption_lab.receipts,reason text not null,recorded_at timestamptz not null default clock_timestamp());
revoke all on consumption_lab.reconciliation from public,anon,authenticated,service_role;
grant select,insert on consumption_lab.reconciliation to lab_executor;
-- All reservation and inventory readers now include the same web/special holds.
create or replace function private.inventory_reserved(p_sku text) returns bigint
language sql volatile security definer set search_path='' as $$
 select (select coalesce(sum(l.quantity),0) from private.inventory_reservation_lines l join private.inventory_reservations r using(reference)
 where l.sku=p_sku and r.status='active' and r.expires_at>clock_timestamp())+
 (select coalesce(sum(quantity),0) from consumption_lab.holds where sku=p_sku and active and expires_at>clock_timestamp());
$$;
grant execute on function private.inventory_reserved(text) to lab_executor;
grant create on schema consumption_lab to lab_executor;
alter function consumption_lab.consume(text,text) rename to consume_stock;
revoke execute on function consumption_lab.consume_stock(text,text) from lab_worker;
create function consumption_lab.consume(p_request text,p_receipt text) returns text
language plpgsql security definer set search_path='' as $$
declare r consumption_lab.requests; e consumption_lab.receipts; item record; reason text; prior text;
begin
 select * into strict r from consumption_lab.requests where id=p_request for update;
 select * into strict e from consumption_lab.receipts where id=p_receipt for update;
 if e.request_id<>r.id or e.owner_id<>r.owner_id or e.session_id<>r.session_id or left(e.session_id,8)<>'cs_test_'
 or e.amount<>r.amount or e.currency<>r.currency or e.state<>'paid' or e.livemode or length(btrim(e.payment_id))=0 then raise exception 'Receipt binding rejected';end if;
 select receipt_id into prior from consumption_lab.orders where request_id=r.id;
 if found then if prior<>e.id then raise exception 'Conflicting receipt';end if;return 'already_consumed';end if;
 if exists(select 1 from consumption_lab.reconciliation where request_id=r.id) then return 'needs_reconciliation';end if;
 if not exists(select 1 from consumption_lab.lines where request_id=r.id) then raise exception 'Empty request';end if;
 perform s.sku from public.inventory_items s join consumption_lab.lines l on l.sku=s.sku where l.request_id=r.id order by s.sku for update of s;
 if r.hold_until<=clock_timestamp() then reason:='reservation_expired';end if;
 for item in select l.*,s.quantity stock_quantity,s.state,s.is_active from consumption_lab.lines l join public.inventory_items s using(sku) where l.request_id=r.id loop
  if not exists(select 1 from consumption_lab.holds h where h.reference=r.id and h.sku=item.sku and h.quantity>=item.quantity and h.active and h.expires_at>clock_timestamp()) then reason:=coalesce(reason,'reservation_missing_or_expired');end if;
  if item.state<>'tracked' or not item.is_active or item.stock_quantity<private.inventory_reserved(item.sku) then reason:=coalesce(reason,'stock_unavailable');end if;
 end loop;
 if reason is not null then
  insert into consumption_lab.reconciliation values(r.id,e.id,reason,clock_timestamp());
  return 'needs_reconciliation';
 end if;
 -- Under all SKU locks, releasing own holds makes guards count only other holds.
 update consumption_lab.holds set active=false where reference=r.id;
 return consumption_lab.consume_stock(r.id,e.id);
end$$;
alter function consumption_lab.consume(text,text) owner to lab_executor;
revoke all on function consumption_lab.consume(text,text) from public,anon,authenticated,service_role;
grant execute on function consumption_lab.consume(text,text) to lab_worker;
create function consumption_lab.reserve(p_reference text,p_sku text,p_quantity integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s public.inventory_items; old consumption_lab.holds; available integer; reserved integer;
begin
 if p_reference is null or length(btrim(p_reference))=0 or p_quantity is null or p_quantity<1 or p_quantity>1000000 then raise exception 'Invalid reservation';end if;
 if current_setting('transaction_isolation')<>'read committed' then raise exception 'Fresh transaction required';end if;
 perform pg_advisory_xact_lock(hashtextextended('lab-shared:'||p_reference,0));
 select * into strict s from public.inventory_items where sku=p_sku for update;
 select * into old from consumption_lab.holds where reference=p_reference and sku=p_sku;
 if found then
  -- Store requested quantity separately so retries cannot turn partial holds into new demand.
  if (select quantity from consumption_lab.reservation_demands where reference=p_reference and sku=p_sku) is distinct from p_quantity then raise exception 'Conflicting reservation retry';end if;
  return jsonb_build_object('status',case when old.active and old.expires_at>clock_timestamp() then 'reserved' else 'expired' end,'reserved',old.quantity,'additional',p_quantity-old.quantity);
 end if;
 if exists(select 1 from consumption_lab.reservation_demands where reference=p_reference and sku=p_sku) then
  if (select quantity from consumption_lab.reservation_demands where reference=p_reference and sku=p_sku)<>p_quantity then raise exception 'Conflicting reservation retry';end if;
  return jsonb_build_object('status','quote','reserved',0,'additional',p_quantity);
 end if;
 available:=case when s.state='tracked' and s.is_active then greatest(0,s.quantity-private.inventory_reserved(p_sku)) else 0 end;
 reserved:=least(p_quantity,available);
 insert into consumption_lab.reservation_demands values(p_reference,p_sku,p_quantity);
 -- Zero holds cannot be stored; retain demand for a quote without claiming stock.
 if reserved>0 then insert into consumption_lab.holds values(p_reference,p_sku,reserved,true,clock_timestamp()+interval '30 minutes');end if;
 return jsonb_build_object('status',case when reserved>0 then 'reserved' else 'quote' end,'reserved',reserved,'additional',p_quantity-reserved);
end$$;
create table consumption_lab.reservation_demands(reference text,sku text,quantity integer not null check(quantity>0),primary key(reference,sku));
revoke all on consumption_lab.reservation_demands from public,anon,authenticated,service_role;
grant select,insert on consumption_lab.reservation_demands to lab_executor;
grant insert on consumption_lab.holds to lab_executor;
alter function consumption_lab.reserve(text,text,integer) owner to lab_executor;
revoke all on function consumption_lab.reserve(text,text,integer) from public,anon,authenticated,service_role;
grant execute on function consumption_lab.reserve(text,text,integer) to lab_worker;
revoke create on schema consumption_lab from lab_executor;
