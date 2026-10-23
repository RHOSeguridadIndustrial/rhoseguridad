// Synthetic signatures and loopback-free PGlite only; no Stripe API calls.
import Stripe from 'stripe';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {paymentRuntime} from './fixtures/receipt-runtime/payment-runtime.js';
const secret='whsec_disposable_synthetic_fixture_only';
const sdk=new Stripe('rk_test_synthetic_fixture_only',{apiVersion:'2026-08-26.dahlia'});
const db=new PGlite();let n=0,commits=0,apiReads=0;
const pass=s=>console.log(`PASS ${++n}: ${s}`);
const q=async(s,p)=>(await db.query(s,p)).rows;
let session;
const original=()=>({id:'cs_test_one',object:'checkout.session',livemode:false,mode:'payment',payment_status:'paid',payment_intent:'pi_one',amount_total:100,currency:'mxn',metadata:{rho_request_id:'r1'},client_reference_id:'r1'});
function FakeNetworkStripe(key,options){
 assert.equal(key,'rk_test_synthetic_fixture_only');assert.equal(options.apiVersion,'2026-08-26.dahlia');
 return {webhooks:sdk.webhooks,checkout:{sessions:{retrieve:async id=>{apiReads++;assert.equal(id,session.id);return session;}}}};
}
async function loadRequest(id){const r=(await q('select * from consumption_lab.requests where session_id=$1',[id]))[0];return r&&{id:r.id,ownerId:r.owner_id,sessionId:r.session_id,totalCents:r.amount,livemode:false};}
async function commitPaid(p){
 commits++;
 await db.exec('begin');
 try {
  const r=(await q('select * from consumption_lab.requests where id=$1 for update',[p.requestId]))[0];
  assert.equal(p.sessionId,r.session_id);assert.equal(p.amountCents,r.amount);assert.equal(p.currency,r.currency);assert.equal(p.livemode,false);
  let receipt=(await q('select id from consumption_lab.receipts where payment_id=$1',[p.paymentIntentId]))[0];
  if(!receipt){
   await q('insert into consumption_lab.receipts values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[p.eventId,r.id,r.owner_id,r.session_id,p.paymentIntentId,p.amountCents,p.currency,'paid',false]);
   receipt={id:p.eventId};
  }
  await db.exec('set local role lab_worker');
  const result=(await q('select consumption_lab.consume($1,$2) result',[p.requestId,receipt.id]))[0].result;
  await db.exec('commit');return {status:result};
 }catch(e){await db.exec('rollback');throw e;}
}
const handler=paymentRuntime({Stripe:FakeNetworkStripe,apiKey:'rk_test_synthetic_fixture_only',signingSecret:secret,enabled:true,loadRequest,commitPaid});
const event=(overrides={})=>({id:'evt_one',object:'event',livemode:false,type:'checkout.session.completed',data:{object:{object:'checkout.session',id:'cs_test_one'}},...overrides});
async function send(e,{tamper=false,badSignature=false}={}){
 const payload=JSON.stringify(e);let body=payload;
 const signature=sdk.webhooks.generateTestHeaderString({payload,secret:badSignature?'whsec_wrong_fixture':secret});
 if(tamper)body+=' ';
 return handler(new Request('https://synthetic.invalid/webhook',{method:'POST',headers:{'stripe-signature':signature},body}));
}
const snapshot=async()=>Promise.all(['public.inventory_items','public.inventory_history','private.inventory_automation_events','consumption_lab.orders','consumption_lab.receipts'].map(t=>q(`select * from ${t} order by 1`)));
try{
 await db.exec(await readFile('/tmp/qw10-integrated-fixture.sql','utf8'));
 await db.exec(`insert into consumption_lab.requests values('r1','owner','cs_test_one',100,'mxn');insert into consumption_lab.lines values('r1','lab-a',2);select set_config('test.uid','',false);`);
 session=original();let before=await snapshot();
 for(const options of [{badSignature:true},{tamper:true}]){
  const response=await send(event(),options);assert.equal(response.status,400);assert.equal(commits,0);assert.equal(apiReads,0);assert.deepEqual(await snapshot(),before);
 }
 pass('official SDK rejects wrong signature and altered raw body before any read or commit');
 assert.equal((await send(event({livemode:true}))).status,500);assert.equal(commits,0);assert.deepEqual(await snapshot(),before);
 pass('signed live-mode event cannot enter test consumption');
 for(const [field,value] of [['amount_total',101],['currency','usd'],['mode','subscription'],['client_reference_id','other']]){
  session={...original(),[field]:value};assert.equal((await send(event())).status,500);assert.equal(commits,0);assert.deepEqual(await snapshot(),before);
 }
 pass('signed notification with mismatched API state cannot create receipt or order');
 session={...original(),payment_status:'unpaid'};let response=await send(event());assert.equal(response.status,200);assert.equal((await response.json()).status,'pending');assert.equal(commits,0);assert.deepEqual(await snapshot(),before);
 pass('unpaid Checkout notification remains pending without fulfillment');
 session=original();response=await send(event());assert.equal(response.status,200);assert.equal((await response.json()).status,'consumed');
 assert.equal((await q("select quantity from public.inventory_items where sku='lab-a'"))[0].quantity,3);
 assert.equal((await q("select count(*)::int n from public.inventory_history where actor_kind='system'"))[0].n,1);
 pass('SDK-verified synthetic event commits receipt, order, stock and automatic history together');
 before=await snapshot();response=await send(event({id:'evt_second_delivery',type:'checkout.session.async_payment_succeeded'}));assert.equal(response.status,200);assert.equal((await response.json()).status,'already_consumed');assert.deepEqual(await snapshot(),before);
 pass('second signed success event for same payment does not duplicate consumption');
 await db.exec(`insert into consumption_lab.requests values('r2','owner','cs_test_two',100,'mxn');insert into consumption_lab.lines values('r2','lab-a',1);`);
 session={...original(),id:'cs_test_two',payment_intent:'pi_two',metadata:{rho_request_id:'r2'},client_reference_id:'r2'};
 before=await snapshot();response=await send(event({id:'evt_two',data:{object:{object:'checkout.session',id:'cs_test_two'}}}));assert.equal(response.status,500);assert.deepEqual(await snapshot(),before);
 pass('reserved-stock failure rolls back receipt and order and returns retryable failure');
 console.log(`RESULT: ${n} signed-receipt integration groups passed. Synthetic credentials and API responses only.`);
}finally{await db.close();}
