import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cardCheckoutHandler} from '../supabase/functions/create-card-checkout/handler.js';
import {quote,address,owner} from './card-database-fixture.mjs';
const body={action:'quote',paymentMethod:'card',items:[{sku:'fixture-sku',quantity:2}],address};
const request=(data=body,headers={Authorization:'Bearer fixture'},method='POST')=>new Request('https://fixture.invalid',
 {method,headers,...(method==='POST'?{body:typeof data==='string'?data:JSON.stringify(data)}:{})});
function setup(overrides={}){
 const called={authorize:0,delivery:0,reserve:0};
 const handler=cardCheckoutHandler({configured:true,authorize:async()=>{called.authorize++;return owner;},
 loadDelivery:async()=>{called.delivery++;return {lookup:postalCode=>({status:'postal_options',postalCode,options:[]}),quote:async()=>quote()};},
 persistence:{reserve:async()=>{called.reserve++;throw Error('unexpected reservation');}},...overrides});
 return {handler,called};
}
test('disabled checkout and foreign origins never reach authorization or persistence',async()=>{
 const off=setup({configured:false});assert.equal((await off.handler(request())).status,503);assert.equal(off.called.authorize,0);
 const f=setup();assert.equal((await f.handler(request(body,{Origin:'https://attacker.invalid'}))).status,403);
 assert.equal(f.called.authorize,0);assert.equal(f.called.reserve,0);
});
test('CORS preflight and methods have defined behavior',async()=>{
 const f=setup(),pre=await f.handler(request(null,{Origin:'https://www.rhosegind.com'},'OPTIONS'));
 assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),'https://www.rhosegind.com');
 assert.equal((await f.handler(request(null,{},'GET'))).status,405);assert.equal(f.called.authorize,0);
});
test('missing, expired and failed user sessions never reach catalog or writes',async()=>{
 for(const authorize of [async()=>null,async()=>{throw Error('expired');}]){
  const f=setup({authorize});assert.equal((await f.handler(request())).status,401);assert.equal(f.called.delivery,0);
 }
 const f=setup();assert.equal((await f.handler(request(body,{}))).status,401);assert.equal(f.called.reserve,0);
});
test('malformed, oversized and test-mode requests are rejected before delivery lookup',async()=>{
 for(const value of ['{bad','x'.repeat(20001),[],{...body,environment:'test'},{...body,action:'unexpected'}]){
  const f=setup();assert.equal((await f.handler(request(value))).status,400);assert.equal(f.called.delivery,0);
 }
});
test('database gate and unavailable postal configuration prevent Checkout creation',async()=>{
 const f=setup({loadDelivery:async()=>null});assert.equal((await f.handler(request())).status,503);assert.equal(f.called.reserve,0);
});
test('preview returns server totals without creating a reservation or a Stripe session',async()=>{
 const f=setup(),response=await f.handler(request({...body,expectedTotalCents:1,ownerId:'attacker'}));
 assert.equal(response.status,200);assert.equal((await response.json()).totalCents,10564);assert.equal(f.called.reserve,0);
});
test('creating Checkout requires accepted server total and does not trust client ownership',async()=>{
 let savedOwner;
 const f=setup({persistence:{loadReservation:async({ownerId})=>{savedOwner=ownerId;return null;},reserve:async()=>{throw Error('must not reserve');},bindSession:async()=>{}},
 stripe:{checkout:{sessions:{create:async()=>{throw Error('must not create');}}}}});
 const response=await f.handler(request({...body,action:'create',ownerId:'attacker',retryKey:'synthetic_retry_key_123',expectedTotalCents:1}));
 assert.equal(response.status,409);assert.equal((await response.json()).error,'card_total_changed');assert.equal(savedOwner,owner);
});
