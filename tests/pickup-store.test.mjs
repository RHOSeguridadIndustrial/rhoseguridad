import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PGlite} from '@electric-sql/pglite';
import {pickupStore} from '../logistics/pickup-store.mjs';

test('persistent pickup queue: payment evidence, retries, rollback, access and restart',async t=>{
 const path=await mkdtemp(join(tmpdir(),'rho-pickup-'));
 let db=new PGlite(path);
 const connect=()=>pickupStore({withTransaction:fn=>db.transaction(fn)});
 let store=connect();
 const event=(id,type,extra={})=>({id,type,orderId:'1',revision:'initial',environment:'test',...extra});
 const shipment={destination:{street:'Ejemplo',number:'1',neighborhood:'Centro',municipality:'Azcapotzalco',recipient:'Cliente ficticio',phone:'5500000000',postalCode:'02000',country:'MX',region:'MX-CMX'},package:{weightKg:1,lengthCm:20,widthCm:10,heightCm:5},route:{verified:true,source:'synthetic',distanceKm:8}};
 try {
  // Minimal synthetic source contract using the QW10 deployed column names.
  await db.exec(`create schema qw10_test;
   create table qw10_test.requests(id text primary key,session_id text,livemode boolean,total_cents bigint);
   create table qw10_test.purchase_orders(id bigint primary key,request_id text,session_id text);
   create table qw10_test.receipts(request_id text,session_id text,state text,amount_cents bigint);
   create role anon; create role authenticated; create role service_role;
   insert into qw10_test.requests values('r1','s1',false,29900),('r2','s2',false,29900),('r3','s3',true,29900),('r4','s4',false,29900),('r5','s5',false,29900);
   insert into qw10_test.purchase_orders values(1,'r1','s1'),(2,'r2','s2'),(3,'r3','s3'),(4,'r4','s4'),(5,'r5','wrong');
   insert into qw10_test.receipts values('r1','s1','paid',29900),('r2','s2','reconciliation_required',29900),('r3','s3','paid',29900),('r4','s4','paid',1),('r5','s5','paid',29900);`);
  await db.exec(await readFile(new URL('../logistics/sql/pickup-queue-draft.sql',import.meta.url),'utf8'));
  await t.test('only matching paid sandbox orders enter; replay creates no duplicate',async()=>{
   const jobs=await store.syncPaidOrders();assert.equal(jobs.length,1);
   assert.equal(jobs[0].state.status,'waiting_preparation');
   assert.equal((await store.syncPaidOrders()).length,0);
   assert.throws(()=>pickupStore({environment:'live'}),/not enabled/);
  });
  await t.test('unknown order, environment, revision and illegal transition rejected',async()=>{
   await assert.rejects(store.applyEvent(event('unknown','package_prepared',{orderId:'100'})),/not queued/);
   await assert.rejects(store.applyEvent(event('live','package_prepared',{environment:'live'})),/environment/);
   await assert.rejects(store.applyEvent(event('rev','package_prepared',{revision:'new'})),/identity/);
   await assert.rejects(store.applyEvent(event('early','booking_started')),/transition/);
   assert.equal((await store.list({status:'waiting_preparation'}))[0].version,1);
  });
  await t.test('atomic failure rolls back state and event; successful retry is possible',async()=>{
   await db.exec(`create function rho_pickup.fail_update() returns trigger language plpgsql as $$begin raise exception 'injected failure';end$$;
    create trigger fail_update before update on rho_pickup.jobs for each row execute function rho_pickup.fail_update();`);
   await assert.rejects(store.applyEvent(event('prepare','package_prepared',{shipment})),/injected failure/);
   assert.equal((await db.query("select count(*)::int n from rho_pickup.events where event_id='prepare'")).rows[0].n,0);
   await db.exec('drop trigger fail_update on rho_pickup.jobs');
   const r=await store.applyEvent(event('prepare','package_prepared',{shipment}));
   assert.equal(r.state.status,'ready_to_quote');assert.deepEqual(r.state.shipment,shipment);
  });
  await t.test('same event replays; changed payload rejected without state mutation',async()=>{
   assert.equal((await store.applyEvent(event('prepare','package_prepared',{shipment}))).repeated,true);
   await assert.rejects(store.applyEvent(event('prepare','order_cancelled')),/payload changed/);
   assert.equal((await store.list({status:'ready_to_quote'}))[0].version,2);
   await assert.rejects(db.query(`insert into rho_pickup.jobs select job_key||'2',environment,order_id,'new',state,version,created_at,updated_at from rho_pickup.jobs`));
  });
  await t.test('pending carrier operation survives database restart; cannot resend',async()=>{
   const decision={status:'recommended',orderId:'1',shipmentRevision:'initial',environment:'test',selected:{providerId:'synthetic',quoteId:'q1'}};
   await store.applyEvent(event('quote','quote_selected',{decision}));
   await store.applyEvent(event('start','booking_started'));
   await db.close();db=new PGlite(path);store=connect();
   const pending=await store.list({status:'booking_pending'});assert.equal(pending.length,1);
   assert.ok(pending[0].state.operationKey);
   assert.equal((await store.applyEvent(event('start','booking_started'))).repeated,true);
   await assert.rejects(store.applyEvent(event('start-again','booking_started')),/transition/);
   await store.applyEvent(event('uncertain','booking_uncertain'));
   await store.applyEvent(event('label','label_confirmed',{providerId:'synthetic',labelId:'l1'}));
   await store.applyEvent(event('pickup','pickup_started'));
   await store.applyEvent(event('done','pickup_confirmed',{providerId:'synthetic',labelId:'l1',pickupId:'p1'}));
   assert.equal((await store.list({status:'pickup_scheduled'})).length,1);
  });
  await t.test('public and application roles cannot read or write queue',async()=>{
   for(const role of ['anon','authenticated','service_role']) {
    for(const sql of ['select * from rho_pickup.jobs','delete from rho_pickup.events','update rho_pickup.jobs set version=99']) {
     await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.exec(sql);}),/permission denied/);
    }
   }
  });
 } finally {await db.close();await rm(path,{recursive:true,force:true});}
});
