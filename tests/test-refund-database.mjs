// Actual SQL + Stripe SDK signatures, synthetic identities/network only.
import {PGlite} from '@electric-sql/pglite';
import Stripe from 'stripe';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {paymentRuntime} from '../supabase/functions/_shared/payment-runtime.js';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111';
const q=async(s,p)=>(await db.query(s,p)).rows,one=async(s,p)=>(await q(s,p))[0];
const reset=()=>db.exec('reset role');let n=0;const pass=s=>console.log(`PASS ${++n}: ${s}`);
const secret='whsec_synthetic_refund_fixture',sdk=new Stripe('rk_test_synthetic_only');
function FixtureStripe(){return {webhooks:sdk.webhooks};}
const commit=async p=>(await one('select public.qw10_test_record_refund($1,$2,$3,$4,$5,$6,$7,$8,$9) data',[p.eventId,p.refundId,p.paymentIntentId,p.amountCents,p.currency,p.status,p.eventType,p.eventCreated,p.livemode])).data;
const handler=paymentRuntime({Stripe:FixtureStripe,apiKey:'rk_test_synthetic_only',signingSecret:secret,enabled:true,loadRequest:()=>{throw Error('wrong route');},commitPaid:()=>{throw Error('wrong route');},commitRefund:commit});
const event=(patch={},object={})=>({id:'evt_refund_ok',type:'refund.created',created:1792800000,livemode:false,data:{object:{id:'re_one',object:'refund',payment_intent:'pi_late',amount:100,currency:'mxn',status:'succeeded',...object}},...patch});
async function send(e,{tamper=false,wrongSecret=false}={}){
 const raw=JSON.stringify(e),signature=sdk.webhooks.generateTestHeaderString({payload:raw,secret:wrongSecret?'whsec_wrong':secret});
 await db.exec('set role service_role');return handler(new Request('https://fixture.invalid',{method:'POST',headers:{'stripe-signature':signature},body:raw+(tamper?' ':'')}));
}
async function snapshot(){await reset();return (await one("select qw10_test.refund_snapshot('late','pi_late',100) data")).data;}
async function effects(){await reset();const out={};for(const table of ['stock','receipts','requests','purchase_orders','movements','fulfillment_events','reconciliation_reviews'])out[table]=await q(`select to_jsonb(t) row from qw10_test.${table} t order by to_jsonb(t)::text`);return out;}
try{
 for(const p of ['tests/fixtures/qw10-deployed-schema.sql','supabase/qw10-test-fulfillment-review.sql'])await db.exec(await readFile(p,'utf8'));
 await q('insert into auth.users values($1)',[owner]);
 await db.exec(`create table public.inventory_items(quantity integer);insert into public.inventory_items values(50);
 insert into qw10_test.stock values('fixture-sku',5,true);
 insert into qw10_test.requests(id,session_id,total_cents,livemode,hold_until,owner_id) values('late','cs_test_late',100,false,clock_timestamp()-interval '1 minute','${owner}');
 insert into qw10_test.lines values('late','fixture-sku',1);set role service_role;`);
 await q("select public.qw10_test_commit_payment('late','cs_test_late','pi_late',100,'mxn','evt_payment')");await reset();
 const before=await effects();
 await db.exec(`create role refund_migration_admin nologin createrole bypassrls;
 alter schema qw10_test owner to refund_migration_admin;
 grant usage,create on schema public,private to refund_migration_admin;
 grant usage on schema auth to refund_migration_admin;
 grant select,insert,update on all tables in schema qw10_test to refund_migration_admin;
 alter function private.qw10_test_review(text,text,text) owner to refund_migration_admin;
 set role refund_migration_admin;`);
 assert.equal((await one('select rolsuper from pg_roles where rolname=current_user')).rolsuper,false);
 const migration=await readFile('supabase/qw10-test-refunds.sql','utf8');await db.exec(migration);await reset();
 assert.deepEqual(await effects(),before);pass('non-superuser migration preserves all existing payment, review and inventory evidence');
 for(const role of ['anon','authenticated']){
  await db.exec('set role '+role);await assert.rejects(commit({}),e=>e.code==='42501');await reset();
 }
 for(const role of ['anon','authenticated','service_role']){
  await db.exec('set role '+role);
  for(const sql of ['select * from qw10_test.refund_events','delete from qw10_test.refund_events',"update qw10_test.refund_events set status='succeeded'","insert into qw10_test.refund_events default values"])
   await assert.rejects(q(sql),e=>e.code==='42501');await reset();
 }
 await db.exec('set role qw10_refund_recorder');
 for(const sql of ['select * from public.inventory_items','update qw10_test.stock set quantity=0','insert into qw10_test.purchase_orders default values','delete from qw10_test.receipts','update qw10_test.refund_events set amount_cents=0'])await assert.rejects(q(sql),e=>e.code==='42501');
 await reset();assert.equal((await one("select pg_has_role('service_role','qw10_refund_recorder','MEMBER') ok")).ok,false);
 pass('recorder has append-only refund access; browsers/backend cannot write evidence directly, recorder cannot touch orders or stock');
 for(const options of [{tamper:true},{wrongSecret:true}])assert.equal((await send(event(),options)).status,400);
 for(const [patch,obj] of [[{livemode:true},{}],[{created:null},{}],[{}, {status:'approved'}],[{type:'refund.failed'},{}],[{}, {amount:0}],[{}, {payment_intent:'bad'}],[{}, {currency:'MXN'}]])assert.equal((await send(event(patch,obj))).status,500);
 assert.equal((await snapshot()).refunds.length,0);pass('invalid signatures, live events and malformed refund evidence cannot enter the database');
 assert.equal((await send(event())).status,200);assert.equal((await send(event())).status,200);
 assert.equal((await snapshot()).state,'refunded');await reset();assert.equal((await one('select count(*)::int n from qw10_test.refund_events')).n,1);
 assert.deepEqual(await effects(),before);pass('one full signed test refund resolves the exception without changing original receipt, note, order or stock; replay is idempotent');
 assert.equal((await send(event({id:'evt_refund_conflict'},{payment_intent:'pi_other'}))).status,500);
 assert.equal((await send(event({}, {status:'pending'}))).status,500);
 assert.equal((await send(event({id:'evt_older',created:1792799999},{status:'pending'}))).status,200);assert.equal((await snapshot()).state,'refunded');
 assert.equal((await send(event({id:'evt_failed',type:'refund.failed',created:1792800001},{status:'failed'}))).status,200);assert.equal((await snapshot()).state,'unresolved');
 assert.equal((await send(event())).status,200);assert.equal((await snapshot()).state,'unresolved');
 assert.equal((await send(event({id:'evt_equal_success',type:'refund.updated',created:1792800001}))).status,200);assert.equal((await snapshot()).state,'unresolved');
 pass('conflicting identities/events reject; delayed old success cannot overwrite later failure; equal-time ambiguity remains open');
 for(const [id,amount,currency,status] of [['partial',50,'mxn','succeeded'],['foreign',100,'usd','succeeded'],['pending',100,'mxn','pending'],['action',100,'mxn','requires_action'],['canceled',100,'mxn','canceled']]){
  assert.equal((await send(event({id:'evt_'+id},{id:'re_'+id,payment_intent:'pi_'+id,amount,currency,status}))).status,200);await reset();
  assert.equal((await one('select qw10_test.refund_snapshot($1,$2,100) data',['not-yet-recorded','pi_'+id])).data.state,'unresolved');
 }
 assert.equal((await send(event({id:'evt_before_receipt'},{id:'re_before',payment_intent:'pi_before'}))).status,200);await reset();
 await db.exec(`insert into qw10_test.requests(id,session_id,total_cents,livemode,hold_until,owner_id) values('before','cs_test_before',100,false,clock_timestamp()-interval '1 minute','${owner}');insert into qw10_test.lines values('before','fixture-sku',1);set role service_role;`);
 await q("select public.qw10_test_commit_payment('before','cs_test_before','pi_before',100,'mxn','evt_before_payment')");await reset();
 assert.equal((await one("select qw10_test.refund_snapshot('before','pi_before',100) data")).data.state,'refunded');
 await db.exec("insert into qw10_test.purchase_orders(request_id,session_id) values('before','cs_test_before')");assert.equal((await one("select qw10_test.refund_snapshot('before','pi_before',100) data")).data.state,'unresolved');
 pass('partial, wrong currency, pending, action and canceled refunds never close cases; pre-receipt events survive; any existing order blocks closure');
 await db.exec('set role authenticated');await q("select set_config('test.uid',$1,false),set_config('test.aal','aal1',false)",[owner]);
 await assert.rejects(q("select public.qw10_test_review('list')"),e=>e.code==='42501');
 await q("select set_config('test.aal','aal2',false)");
 const cases=(await one("select public.qw10_test_review('list') data")).data.cases;
 assert.equal(cases.find(c=>c.request_id==='late').resolution.state,'unresolved');
 await q("select public.qw10_test_review('review','late','Synthetic review does not resolve a payment.')");
 assert.equal((await one("select public.qw10_test_review('list') data")).data.cases.find(c=>c.request_id==='late').resolution.state,'unresolved');
 await reset();assert.equal((await one('select sum(quantity)::int total from public.inventory_items')).total,50);
 pass('MFA remains required and review note does not resolve a failed refund; real-inventory fixture unchanged');
 if(process.argv.includes('--export-fixture')){
  // Existing upgrade exporter supplies PostgreSQL fixture; append the exact new migration.
  const base=await readFile('/tmp/qw10-deployed-upgraded.sql','utf8');await writeFile('/tmp/qw10-refund-schema.sql',base+'\n'+migration);
 }
 console.log(`RESULT: ${n} refund integration groups passed.`);
}catch(e){console.error(e.message,e.code);process.exitCode=1;}finally{await db.close();}
