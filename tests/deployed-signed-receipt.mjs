// Real SDK signature verification + deployed database schema; all identities and
// network responses are synthetic. No remote calls or credentials.
import Stripe from 'stripe';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {paymentRuntime} from '../supabase/functions/_shared/payment-runtime.js';
const db=new PGlite(),secret='whsec_local_fixture_only',key='rk_test_local_fixture_only';
const sdk=new Stripe(key,{apiVersion:'2026-08-26.dahlia'});
let current,reads=0,commits=0,passed=0;
const pass=s=>console.log(`PASS ${++passed}: ${s}`);
const q=async(s,p)=>(await db.query(s,p)).rows;
function FixtureStripe(){return {webhooks:sdk.webhooks,checkout:{sessions:{retrieve:async()=>{reads++;return current;}}}};}
const handler=paymentRuntime({Stripe:FixtureStripe,apiKey:key,signingSecret:secret,enabled:true,
 loadRequest:async id=>(await q('select public.qw10_test_load_request($1) result',[id]))[0].result,
 commitPaid:async p=>{commits++;return (await q('select public.qw10_test_commit_payment($1,$2,$3,$4,$5,$6) result',[p.requestId,p.sessionId,p.paymentIntentId,p.amountCents,p.currency,p.eventId]))[0].result;}
});
function session(id){return {id:`cs_test_${id}`,object:'checkout.session',livemode:false,mode:'payment',payment_status:'paid',payment_intent:`pi_${id}`,amount_total:100,currency:'mxn',metadata:{rho_request_id:id},client_reference_id:id};}
async function send(id,{tamper=false,wrongSecret=false,eventId=`evt_${id}`,type='checkout.session.completed'}={}){
 const raw=JSON.stringify({id:eventId,object:'event',livemode:false,type,data:{object:{object:'checkout.session',id:`cs_test_${id}`}}});
 const sig=sdk.webhooks.generateTestHeaderString({payload:raw,secret:wrongSecret?'whsec_wrong':secret});
 return handler(new Request('https://fixture.invalid',{method:'POST',headers:{'stripe-signature':sig},body:raw+(tamper?' ':'')}));
}
async function counts(){await db.exec('reset role');const row=(await q("select (select count(*)::int from qw10_test.receipts) receipts,(select count(*)::int from qw10_test.purchase_orders) orders,(select count(*)::int from qw10_test.fulfillment_events) events,(select quantity from qw10_test.stock where sku='fixture-sku') stock"))[0];await db.exec('set role service_role');return row;}
try{
 await db.exec(await readFile('/tmp/qw10-deployed-upgraded.sql','utf8'));
 await db.exec("insert into qw10_test.stock values('fixture-sku',2,true);insert into qw10_test.requests(id,session_id,total_cents,livemode,hold_until,owner_id) values('one','cs_test_one',100,false,clock_timestamp()+interval '1 hour','fixture-owner');insert into qw10_test.lines values('one','fixture-sku',1);set role service_role;");
 current=session('one');
 for(const option of [{tamper:true},{wrongSecret:true}])assert.equal((await send('one',option)).status,400);
 assert.equal(reads,0);assert.equal(commits,0);pass('invalid SDK signature or altered raw body never reaches the database');
 for(const change of [{amount_total:101},{currency:'usd'},{livemode:true},{client_reference_id:'other'},{metadata:{rho_request_id:'other'}}]){
  current={...session('one'),...change};assert.equal((await send('one')).status,500);
 }assert.equal(commits,0);pass('authoritative payment mismatches reject before fulfillment');
 current={...session('one'),payment_status:'unpaid'};assert.equal((await (await send('one')).json()).status,'pending');assert.equal(commits,0);pass('unpaid notification remains pending without an order');
 current=session('one');assert.equal((await (await send('one')).json()).status,'paid');
 assert.deepEqual(await counts(),{receipts:1,orders:1,events:1,stock:1});pass('verified fixture payment reaches the restricted database function and records actor/order/stock together');
 assert.equal((await (await send('one',{eventId:'evt_redelivery',type:'checkout.session.async_payment_succeeded'})).json()).status,'paid');
 assert.deepEqual(await counts(),{receipts:1,orders:1,events:1,stock:1});pass('a second signed success event cannot duplicate fulfillment');
 await db.exec("reset role;insert into qw10_test.requests(id,session_id,total_cents,livemode,hold_until,owner_id) values('late','cs_test_late',100,false,clock_timestamp()-interval '1 minute','fixture-owner');insert into qw10_test.lines values('late','fixture-sku',1);set role service_role;");
 current=session('late');assert.equal((await (await send('late')).json()).status,'reconciliation_required');
 assert.deepEqual(await counts(),{receipts:2,orders:1,events:2,stock:1});pass('late signed payment keeps receipt and review evidence without an order or inventory discount');
 console.log(`RESULT: ${passed} signed-receipt/deployed-schema groups passed with synthetic API responses.`);
}finally{await db.close();}
