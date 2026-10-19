-- LOCAL LAB ONLY. Synthetic ledger, not a deployable Supabase migration.
-- No public.inventory_items references, network calls, real payment verification or live adapter.
create schema consumption_lab;
create table consumption_lab.stock(sku text primary key,quantity integer not null check(quantity>=0));
create table consumption_lab.holds(reference text primary key,owner_id text not null,channel text not null check(channel in ('web','special')),amount_cents bigint not null check(amount_cents>0),expires_at timestamptz not null,state text not null default 'active' check(state in ('active','consumed','cancelled')));
create table consumption_lab.hold_lines(reference text not null references consumption_lab.holds,sku text not null references consumption_lab.stock,quantity integer not null check(quantity>0),primary key(reference,sku));
-- Only the local test runner inserts simulated verified receipts.
create table consumption_lab.receipts(payment text primary key,reference text not null unique references consumption_lab.holds,owner_id text not null,amount_cents bigint not null,currency text not null check(currency='mxn'),verified boolean not null,livemode boolean not null check(not livemode));
create table consumption_lab.orders(reference text primary key references consumption_lab.holds,payment text not null unique references consumption_lab.receipts);
create table consumption_lab.movements(reference text not null references consumption_lab.orders,sku text not null references consumption_lab.stock,quantity integer not null check(quantity>0),primary key(reference,sku));
create function consumption_lab.guard_stock() returns trigger language plpgsql security invoker set search_path='' as $$
declare held bigint;
begin
 select coalesce(sum(l.quantity),0) into held from consumption_lab.hold_lines l join consumption_lab.holds h using(reference) where l.sku=old.sku and h.state='active' and h.expires_at>clock_timestamp();
 if new.quantity<held then raise exception 'Stock would consume another reservation';end if;
 return new;
end;$$;
create trigger stock_guard before update on consumption_lab.stock for each row execute function consumption_lab.guard_stock();
create function consumption_lab.consume(p_owner text,p_reference text,p_payment text) returns text language plpgsql security invoker set search_path='' as $$
declare h consumption_lab.holds; receipt consumption_lab.receipts; existing consumption_lab.orders;
begin
 -- Same lock order for consumption and future reservation cancellation.
 perform pg_advisory_xact_lock(hashtextextended('lab:'||p_reference,0));
 select * into h from consumption_lab.holds where reference=p_reference for update;
 if h.reference is null or h.owner_id is distinct from p_owner then raise exception 'Unknown reservation';end if;
 select * into receipt from consumption_lab.receipts where payment=p_payment;
 if receipt.payment is null or receipt.reference<>p_reference or receipt.owner_id<>p_owner or receipt.amount_cents<>h.amount_cents or receipt.currency<>'mxn' or not receipt.verified or receipt.livemode then raise exception 'Unverified or mismatched payment';end if;
 select * into existing from consumption_lab.orders where reference=p_reference;
 if found then
  if existing.payment<>p_payment then raise exception 'Payment changed';end if;
  return 'already_consumed';
 end if;
 if not exists(select 1 from consumption_lab.hold_lines where reference=p_reference) then raise exception 'Empty reservation';end if;
 perform 1 from consumption_lab.stock s join consumption_lab.hold_lines l on l.sku=s.sku where l.reference=p_reference order by s.sku for update of s;
 -- Evaluate expiry AFTER waiting for the inventory lock.
 if h.state<>'active' or h.expires_at<=clock_timestamp() then return 'reconciliation';end if;
 -- Guard remains enabled: only this hold stops counting, all other holds remain protected.
 update consumption_lab.holds set state='consumed' where reference=p_reference;
 update consumption_lab.stock s set quantity=s.quantity-l.quantity from consumption_lab.hold_lines l where l.reference=p_reference and l.sku=s.sku;
 insert into consumption_lab.orders values(p_reference,p_payment);
 insert into consumption_lab.movements select p_reference,sku,quantity from consumption_lab.hold_lines where reference=p_reference;
 return 'consumed';
end;$$;
revoke all on schema consumption_lab from public;
revoke all on all tables in schema consumption_lab from public;
revoke all on all functions in schema consumption_lab from public;
