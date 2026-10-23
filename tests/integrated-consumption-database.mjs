import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite(), admin='11111111-1111-4111-8111-111111111111';
const load=p=>readFile(new URL(p,import.meta.url),'utf8');
const q=async s=>(await db.query(s)).rows;let count=0;
const pass=s=>console.log(`PASS ${++count}: ${s}`);
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema private;create schema auth;create schema qw10_actor_lab;
 create table qw10_actor_lab.only_synthetic_data(marker boolean);
 create table auth.users(id uuid primary key);insert into auth.users values('${admin}');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function private.is_admin() returns boolean language sql as $$select auth.uid()='${admin}'::uuid and current_setting('test.aal',true)='aal2'$$;
 grant usage on schema private,auth to authenticated,service_role;
 create table public.products(id text primary key,is_active boolean not null);grant select on public.products to anon,authenticated;
 insert into public.products values('lab-product',true);
 select set_config('test.uid','${admin}',false);select set_config('test.aal','aal2',false);`);
 await db.exec(await load('../supabase/migrations/20261007181348_add_admin_inventory_and_pending_purchase_import.sql'));
 await db.exec('create table private.quote_request_references(serial_number integer primary key);insert into private.quote_request_references values(1)');
 await db.exec(await load('../supabase/reservations.sql'));
 await db.exec(`set role authenticated;select public.inventory_create('lab-a','lab-product','Synthetic','pieza');
 select public.inventory_adjust('lab-a','receive',5,1,'pieza',true,'Initial fixture',1);
 select public.inventory_reservation('create','RHO-00000001','[{"sku":"lab-a","quantity":3}]');reset role;`);
 await db.exec(await load('./fixtures/qw10-actor-contract-up.sql'));
 // Private transaction-scoped capability populated only by the isolated fixture owner.
 // Not a production worker authorization mechanism or Stripe receipt verifier.
 await db.exec(`create table private.lab_write_context(tx bigint,sku text,event_id uuid references private.inventory_automation_events,old_quantity integer,new_quantity integer,primary key(tx,sku));
 alter table private.lab_write_context enable row level security;
 revoke all on private.lab_write_context from public,anon,authenticated,service_role;
 create function private.lab_authorized(s text,oldq integer,newq integer) returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from private.lab_write_context where tx=txid_current() and sku=s and old_quantity=oldq and new_quantity=newq and newq<oldq)$$;
 revoke all on function private.lab_authorized(text,integer,integer) from public;
 grant execute on function private.lab_authorized(text,integer,integer) to authenticated;`);
 const originals=await q(`select p.proname,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('inventory_before_write','inventory_reservation_guard','inventory_audit')`);
 for(const f of originals){
   let sql=f.definition;
   if(f.proname==='inventory_audit') {
     sql=sql.replace('begin',`begin
 if tg_op='UPDATE' and private.lab_authorized(old.sku,old.quantity,new.quantity) then
 insert into public.inventory_history(sku,old_quantity,new_quantity,old_state,new_state,old_details,new_details,reason,changed_by,actor_kind,automation_event_id)
 select new.sku,old.quantity,new.quantity,old.state,new.state,to_jsonb(old),to_jsonb(new),'Synthetic verified receipt',null,'system',event_id
 from private.lab_write_context where tx=txid_current() and sku=new.sku;
 return new;end if;`);
   } else {
     sql=sql.replace("if auth.uid() is null or not private.is_admin() then", "if not (tg_op='UPDATE' and private.lab_authorized(old.sku,old.quantity,new.quantity)) and (auth.uid() is null or not private.is_admin()) then");
   }
   await db.exec(sql);
 }
 let source=await load('./fixtures/qw10-consumption-lab.sql');
 source=source.replace('create table consumption_lab.stock(sku text primary key, quantity integer not null check(quantity>=0));','').replaceAll('consumption_lab.stock','public.inventory_items');
 source=source.replace('update public.inventory_items set quantity=quantity-line.quantity',`insert into private.inventory_automation_events(id,sku,service_name,request_reference,checkout_session,payment_reference,source_event,livemode)
 values(gen_random_uuid(),line.sku,'payment-worker-test',r.id,r.session_id,e.payment_id,e.id,false);
 insert into private.lab_write_context select txid_current(),line.sku,id,current_quantity,current_quantity-line.quantity from private.inventory_automation_events where source_event=e.id and sku=line.sku;
 perform set_config('rho.inventory_reason','Synthetic verified receipt',true);
 update public.inventory_items set quantity=quantity-line.quantity`);
 source=source.replace("return 'consumed';","delete from private.lab_write_context where tx=txid_current();return 'consumed';");
 await db.exec(source);
 await db.exec(`insert into consumption_lab.requests values('r1','owner','cs_test_one',100,'mxn');
 insert into consumption_lab.lines values('r1','lab-a',2);
 insert into consumption_lab.receipts values('e1','r1','owner','cs_test_one','pi_one',100,'mxn','paid',false);
 select set_config('test.uid','',false);`);
 const consume=()=>q("select consumption_lab.consume('r1','e1') result");
 assert.equal((await consume())[0].result,'consumed');
 assert.equal((await q("select quantity from public.inventory_items where sku='lab-a'"))[0].quantity,3);
 let h=(await q('select * from public.inventory_history order by id desc limit 1'))[0];
 assert.equal(h.actor_kind,'system');assert.equal(h.changed_by,null);assert.ok(h.automation_event_id);
 assert.equal((await q('select count(*)::int n from private.lab_write_context'))[0].n,0);
 pass('receipt consumption reaches original inventory table and records automatic actor with no human impersonation');
 assert.equal((await consume())[0].result,'already_consumed');
 assert.equal((await q('select count(*)::int n from public.inventory_history where actor_kind=\'system\''))[0].n,1);
 pass('retry preserves one automatic history entry');
 await db.exec(`insert into consumption_lab.requests values('r2','owner','cs_test_two',100,'mxn');
 insert into consumption_lab.lines values('r2','lab-a',1);
 insert into consumption_lab.receipts values('e2','r2','owner','cs_test_two','pi_two',100,'mxn','paid',false);`);
 await assert.rejects(q("select consumption_lab.consume('r2','e2')"),/Hay piezas reservadas/);
 assert.equal((await q('select count(*)::int n from private.inventory_automation_events'))[0].n,1);
 assert.equal((await q('select count(*)::int n from consumption_lab.orders'))[0].n,1);
 pass('existing manual reservation guard rejects automated consumption and rolls back event and order');
 await db.exec(`set role authenticated;select set_config('rho.inventory_actor','system',false);`);
 await assert.rejects(db.exec("insert into private.lab_write_context values(txid_current(),'lab-a',null,3,2)"),e=>e.code==='42501');
 assert.equal((await q("update public.inventory_items set quantity=2 where sku='lab-a' returning sku")).length,0);
 await db.exec('reset role');pass('client cannot forge private write context or enable system mode');
 await assert.rejects(db.exec("update public.inventory_items set quantity=2 where sku='lab-a'"),e=>e.code==='42501');
 pass('transaction context cannot authorize a later unbound write');
 await db.exec(`select set_config('test.uid','${admin}',false);set role authenticated;
 select public.inventory_adjust('lab-a','receive',1,1,'pieza',true,'Manual after system',3);reset role;`);
 h=(await q('select * from public.inventory_history order by id desc limit 1'))[0];assert.equal(h.actor_kind,'human');assert.equal(h.changed_by,admin);
 pass('manual administrator adjustment still records human actor after automatic consumption');
 console.log(`RESULT: ${count} integration checks passed; disposable in-memory fixture only.`);
} finally {await db.close();}
