-- Disposable design lab. No operational schema, deployment or external receipt ingestion.
create schema consumption_lab;
revoke all on schema consumption_lab from public;
create table consumption_lab.stock(sku text primary key, quantity integer not null check(quantity>=0));
create table consumption_lab.requests(id text primary key, owner_id text not null, session_id text unique not null, amount integer not null check(amount>0), currency text not null);
create table consumption_lab.lines(request_id text references consumption_lab.requests,sku text references consumption_lab.stock,quantity integer not null check(quantity>0),primary key(request_id,sku));
create table consumption_lab.holds(reference text,sku text references consumption_lab.stock,quantity integer not null check(quantity>0),active boolean not null,expires_at timestamptz not null,primary key(reference,sku));
-- Only fixture owner populates receipts. This DOES NOT verify a Stripe signature.
create table consumption_lab.receipts(id text primary key,request_id text not null,owner_id text not null,session_id text not null,payment_id text unique not null,amount integer not null,currency text not null,state text not null,livemode boolean not null);
create table consumption_lab.orders(request_id text primary key references consumption_lab.requests,receipt_id text unique references consumption_lab.receipts);
create table consumption_lab.history(request_id text references consumption_lab.orders,sku text,old_quantity integer,new_quantity integer,actor_kind text check(actor_kind='system'),receipt_id text references consumption_lab.receipts,primary key(request_id,sku));
create function consumption_lab.consume(p_request text,p_receipt text) returns text language plpgsql security invoker set search_path='' as $$
declare r consumption_lab.requests; e consumption_lab.receipts; line record; current_quantity integer; held bigint; prior text;
begin
 select * into strict r from consumption_lab.requests where id=p_request for update;
 select * into strict e from consumption_lab.receipts where id=p_receipt for update;
 if e.request_id<>r.id or e.owner_id<>r.owner_id or e.session_id<>r.session_id
 or left(e.session_id,8)<>'cs_test_' or e.amount<>r.amount or e.currency<>r.currency
 or e.state<>'paid' or e.livemode or length(btrim(e.payment_id))=0 then
 raise exception 'Receipt binding rejected'; end if;
 select receipt_id into prior from consumption_lab.orders where request_id=r.id;
 if found then
   if prior<>e.id then raise exception 'Conflicting receipt'; end if;
   return 'already_consumed';
 end if;
 if not exists(select 1 from consumption_lab.lines where request_id=r.id) then raise exception 'Empty request'; end if;
 -- All participating writers must take the same SKU locks in the same order.
 perform s.sku from consumption_lab.stock s join consumption_lab.lines l on l.sku=s.sku
 where l.request_id=r.id order by s.sku for update of s;
 insert into consumption_lab.orders values(r.id,e.id);
 for line in select * from consumption_lab.lines where request_id=r.id order by sku loop
   select quantity into strict current_quantity from consumption_lab.stock where sku=line.sku;
   select coalesce(sum(quantity),0) into held from consumption_lab.holds
    where sku=line.sku and reference<>r.id and active and expires_at>clock_timestamp();
   if current_quantity-held<line.quantity then raise exception 'Insufficient unreserved stock'; end if;
   update consumption_lab.stock set quantity=quantity-line.quantity where sku=line.sku;
   insert into consumption_lab.history values(r.id,line.sku,current_quantity,current_quantity-line.quantity,'system',e.id);
 end loop;
 update consumption_lab.holds set active=false where reference=r.id;
 return 'consumed';
end $$;
revoke all on all tables in schema consumption_lab from public;
revoke execute on function consumption_lab.consume(text,text) from public;
