// Exercises the captured deployed RPC bodies/ACLs, in memory only. No network or real data.
import {PGlite} from '@electric-sql/pglite';
import Stripe from 'stripe';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {deployedFixture,snapshotHash} from './deployed-schema-fixture.mjs';
import {paymentRuntime} from './fixtures/receipt-runtime/payment-runtime.js';
const db=new PGlite(); let checks=0;
const pass=s=>console.log(`PASS ${++checks}: ${s}`);
const q=async(s,p)=>(await db.query(s,p)).rows;
async function rpc(name,args,role='service_role') {
  assert.match(name,/^qw10_test_[a-z_0-9]+$/);
  await db.exec('begin; set local role '+role);
  try {const r=(await q(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0].result;await db.exec('commit');return r;}
  catch(e){await db.exec('rollback');throw e;}
}
const quote=(lines)=>({currency:'mxn',totalCents:200,lines});
const identity=lines=>JSON.stringify({items:[...lines].sort((a,b)=>a.sku.localeCompare(b.sku)),address:{postalCode:'02000'}});
const lines=[{sku:'test-snapshot-a',quantity:2}];
async function reserve(key='retry_snapshot_0001',items=lines){return rpc('qw10_test_reserve_v2',['owner-a',key,quote(items),identity(items)]);}
async function bind(r,session='cs_test_snapshot'){return rpc('qw10_test_bind',[r.id,'owner-a',session]);}
async function counts(){return (await q(`select (select count(*)::int from qw10_test.receipts) receipts,(select count(*)::int from qw10_test.purchase_orders) orders,(select count(*)::int from qw10_test.movements) movements,(select sum(quantity)::int from qw10_test.stock) stock,(select count(*)::int from qw10_test.preparation_events) preparation`))[0];}
async function reset(){await db.exec(`truncate qw10_test.stock,qw10_test.requests,qw10_test.lines,qw10_test.quote_holds,qw10_test.special_requests,qw10_test.receipts,qw10_test.purchase_orders,qw10_test.movements,qw10_test.preparation_events restart identity;insert into qw10_test.stock values('test-snapshot-a',3,true),('test-snapshot-b',1,true);`);}
const secret='whsec_synthetic_snapshot_only';
const sdk=new Stripe('rk_test_synthetic_fixture_only',{apiVersion:'2026-08-26.dahlia'});
let apiState,apiReads=0;
function StripeFixture(){return {webhooks:sdk.webhooks,checkout:{sessions:{retrieve:async()=>{apiReads++;return apiState;}}}};}
const handler=paymentRuntime({Stripe:StripeFixture,apiKey:'rk_test_synthetic_fixture_only',signingSecret:secret,enabled:true,
  loadRequest:session=>rpc('qw10_test_load_request',[session]),
  commitPaid:p=>rpc('qw10_test_commit_payment',[p.requestId,p.sessionId,p.paymentIntentId,p.amountCents,p.currency,p.eventId])});
const sessionFor=(r,id='cs_test_snapshot',payment='pi_snapshot')=>({id,object:'checkout.session',livemode:false,mode:'payment',payment_status:'paid',payment_intent:payment,amount_total:200,currency:'mxn',metadata:{rho_request_id:r.id},client_reference_id:r.id});
async function notify(id='evt_snapshot',options={}) {
  const payload=JSON.stringify({id,livemode:options.live??false,type:options.type||'checkout.session.completed',data:{object:{object:'checkout.session',id:apiState.id}}});
  const signature=sdk.webhooks.generateTestHeaderString({payload,secret:options.badSignature?'whsec_wrong':secret});
  const res=await handler(new Request('https://synthetic.invalid',{method:'POST',headers:{'stripe-signature':signature},body:payload+(options.tamper?' ':'')}));
  return {code:res.status,...await res.json()};
}
try {
  const ddl=deployedFixture();await writeFile('/tmp/qw10-deployed-fixture.sql',ddl);await db.exec(ddl);await reset();
  await db.exec("create table public.inventory_items(sku text primary key,quantity integer);insert into public.inventory_items values('real-stock-sentinel',50);");
  for(const role of ['anon','authenticated']) {
    await assert.rejects(rpc('qw10_test_commit_payment',['fake','cs_test_fake','pi_fake',200,'mxn','evt_fake'],role),/permission denied/);
    await db.exec('begin;set local role '+role);
    await assert.rejects(q('select * from qw10_test.stock'),/permission denied/);await db.exec('rollback');
  }
  assert.equal((await q("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname like 'qw10_test_%' and p.prosecdef"))[0].n,0);
  pass('deployed RPCs and test tables reject anonymous/authenticated direct access; no definer introduced');
  const r=await reserve();const saved=await reserve();assert.deepEqual(saved,r);
  await assert.rejects(reserve('retry_snapshot_0001',[{sku:'test-snapshot-a',quantity:1}]),/Retry changed/);
  const special=await rpc('qw10_test_special_order',['owner-a','special_snapshot_001','test-snapshot-a',3]);
  assert.equal(special.reserved,1);assert.equal(special.additional,2);
  assert.deepEqual(await rpc('qw10_test_special_order',['owner-a','special_snapshot_001','test-snapshot-a',3]),special);
  await assert.rejects(rpc('qw10_test_special_order',['owner-a','special_snapshot_001','test-snapshot-a',4]),/Retry changed/);
  pass('web and special reservations share stock; retries preserve quantities, identity and deadlines');
  await assert.rejects(rpc('qw10_test_bind',[r.id,'other-owner','cs_test_snapshot']),/Invalid test hold/);
  await assert.rejects(bind(r,'cs_live_snapshot'),/Test session required/);await bind(r);
  await assert.rejects(bind(r,'cs_test_different'),/Session already bound/);
  apiState=sessionFor(r);let before=await counts();
  for(const options of [{badSignature:true},{tamper:true}])assert.equal((await notify('evt_invalid',options)).code,400);
  assert.equal(apiReads,0);assert.deepEqual(await counts(),before);
  assert.equal((await notify('evt_live',{live:true})).code,500);
  for(const [field,value] of [['currency','usd'],['amount_total',201],['client_reference_id','wrong'],['livemode',true]]) {
    apiState={...sessionFor(r),[field]:value};assert.equal((await notify()).code,500);assert.deepEqual(await counts(),before);
  }
  apiState={...sessionFor(r),payment_status:'unpaid'};assert.equal((await notify()).status,'pending');assert.deepEqual(await counts(),before);
  pass('owner/session binding, raw signatures and authoritative paid state protect the exact deployed adapter');
  apiState=sessionFor(r);assert.equal((await notify()).status,'paid');
  assert.deepEqual(await counts(),{receipts:1,orders:1,movements:1,stock:2,preparation:0});
  assert.equal((await q("select quantity from qw10_test.stock where sku='test-snapshot-a'"))[0].quantity,1);
  assert.equal((await q('select quantity from qw10_test.movements'))[0].quantity,2);
  assert.equal((await q('select hold_active from qw10_test.requests'))[0].hold_active,false);
  before=await counts();assert.equal((await notify('evt_retry',{type:'checkout.session.async_payment_succeeded'})).status,'paid');assert.deepEqual(await counts(),before);
  apiState={...sessionFor(r),payment_intent:'pi_other'};assert.equal((await notify('evt_conflict')).code,500);assert.deepEqual(await counts(),before);
  pass('signed simulated payment commits one receipt/order/movement and only its test stock; retries cannot duplicate');
  assert.equal(await rpc('qw10_test_order_status',['other-owner','cs_test_snapshot']),null);
  await assert.rejects(rpc('qw10_test_prepare',['other-owner','cs_test_snapshot','prepare']),/not found/);
  await assert.rejects(rpc('qw10_test_prepare',['owner-a','cs_test_snapshot','dispatch']),/Preparation required/);
  await rpc('qw10_test_prepare',['owner-a','cs_test_snapshot','prepare']);await rpc('qw10_test_prepare',['owner-a','cs_test_snapshot','prepare']);
  await rpc('qw10_test_prepare',['owner-a','cs_test_snapshot','dispatch']);await rpc('qw10_test_prepare',['owner-a','cs_test_snapshot','dispatch']);
  assert.equal((await counts()).preparation,2);assert.equal((await rpc('qw10_test_order_status',['owner-a','cs_test_snapshot'])).preparation.state,'dispatched');
  pass('deployed preparation flow enforces owner/order and ordering; repeated prepare/dispatch stays idempotent');
  await reset();const late=await reserve();await bind(late);
  await q("update qw10_test.requests set hold_until=clock_timestamp()-interval '1 second' where id=$1",[late.id]);
  apiState=sessionFor(late);assert.equal((await notify()).status,'reconciliation_required');
  assert.deepEqual(await counts(),{receipts:1,orders:0,movements:0,stock:4,preparation:0});
  const lateStatus=await rpc('qw10_test_order_status',['owner-a','cs_test_snapshot']);assert.equal(lateStatus.state,'reconciliation_required');assert.equal(lateStatus.orderId,null);
  assert.equal((await notify('evt_late_retry')).status,'reconciliation_required');
  await assert.rejects(rpc('qw10_test_prepare',['owner-a','cs_test_snapshot','prepare']),/Paid test order required/);
  pass('late paid receipt persists for reconciliation and is visible through owner status; cannot create/prepare an order');
  await reset();const multi=await reserve('retry_snapshot_multi',[{sku:'test-snapshot-a',quantity:2},{sku:'test-snapshot-b',quantity:1}]);await bind(multi);
  // Simulate a fixture-only competing hold/inconsistent stock situation after reservation.
  await db.exec("insert into qw10_test.quote_holds values('synthetic-competing','test-snapshot-b',1,clock_timestamp()+interval '5 minutes',true)");
  apiState=sessionFor(multi);assert.equal((await notify()).status,'reconciliation_required');
  assert.deepEqual(await counts(),{receipts:1,orders:0,movements:0,stock:4,preparation:0});
  pass('multi-SKU paid request with competing hold reconciles all lines without partial stock deduction');
  await reset();const exp=await rpc('qw10_test_special_order',['owner-a','special_snapshot_exp','test-snapshot-b',3]);
  await q("update qw10_test.special_requests set expires_at=clock_timestamp()-interval '1 second' where id=$1",[exp.reference]);
  await q("update qw10_test.quote_holds set expires_at=clock_timestamp()-interval '1 second' where reference=$1",[exp.reference]);
  assert.equal((await rpc('qw10_test_special_order_status',['owner-a',exp.reference])).state,'expired');
  assert.equal(await rpc('qw10_test_special_order_status',['other-owner',exp.reference]),null);
  await assert.rejects(rpc('qw10_test_special_order',['owner-a','special_snapshot_exp','test-snapshot-b',3]),/expired/);
  const replacement=await reserve('retry_after_expiry_01',[{sku:'test-snapshot-b',quantity:1}]);assert.ok(replacement.id);
  assert.equal((await q('select active from qw10_test.quote_holds'))[0].active,true);
  pass('expired active=true special hold releases availability; lookup is owner-scoped and retry never renews it');
  await reset();const recover=await reserve();await bind(recover);apiState=sessionFor(recover);
  await db.exec(`create function qw10_test.inject_failure() returns trigger language plpgsql as $$begin raise exception 'Synthetic audit failure';end$$;
    create trigger synthetic_failure before insert on qw10_test.movements for each row execute function qw10_test.inject_failure();`);
  before=await counts();assert.equal((await notify()).code,500);assert.deepEqual(await counts(),before);
  assert.equal((await q('select hold_active from qw10_test.requests'))[0].hold_active,true);
  await db.exec('drop trigger synthetic_failure on qw10_test.movements;drop function qw10_test.inject_failure();');
  assert.equal((await notify('evt_recovery')).status,'paid');assert.equal((await counts()).orders,1);
  pass('injected movement failure rolls back receipt, order and stock; subsequent signed retry recovers once');
  assert.deepEqual(await q('select * from public.inventory_items'),[{sku:'real-stock-sentinel',quantity:50}]);
  console.log(`RESULT: ${checks} deployed-sandbox contract groups passed; snapshot SHA256 ${snapshotHash}. No remote writes or real API calls.`);
} finally {await db.close();}
