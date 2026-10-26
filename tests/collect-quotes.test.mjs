import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectQuotes} from '../logistics/collect-quotes.mjs';
const clock=1000000;
const order={id:'o',shipmentRevision:'r',environment:'test',currency:'MXN',subtotalCents:50000,
 customerShippingCents:0,packagingCents:1000,grossContributionCents:25000,paymentState:'paid',packageReady:true,
 destinationRegion:'MX-CMX',distanceKm:10,readyAt:clock,deliveryDeadline:clock+10000,
 package:{weightKg:1,lengthCm:20,widthCm:10,heightCm:10}};
const policy={minimumRemainingContributionCents:10000};
const quote=(source,totalCents=8000)=>({id:source+'-q',providerId:source,quoteSourceId:source,orderId:'o',shipmentRevision:'r',environment:'test',currency:'MXN',
 quotedAt:clock-1,expiresAt:clock+5000,coverageConfirmed:true,packageAccepted:true,singlePackagePickup:true,
 pickupAvailable:true,pickupAt:clock+1000,deliveryAt:clock+5000,approvedForAutomaticSelection:true,
 completedDeliveries:10,onTimeDeliveries:10,allChargesIncluded:true,requiredProtectionIncluded:true,totalCents,quotedBillableKg:1,
 packageRules:{verified:true,weightMethod:'actual',roundingKg:1,maxActualKg:10,maxBillableKg:10,maxLongestCm:100,maxMiddleCm:100,maxShortestCm:100}});
const run=(adapters,extra={})=>collectQuotes({order,policy,adapters,now:()=>clock,timeoutMs:100,...extra});
test('providers start in parallel and cheaper valid offer wins',async()=>{
 let started=0,release;const gate=new Promise(r=>release=r);
 const adapters=['a','b'].map((id,i)=>({id,quote:async o=>{started++;if(started===2)release();await gate;o.id='mutated';return [quote(id,8000-i*1000)];}}));
 const r=await run(adapters);assert.equal(started,2);assert.equal(order.id,'o');
 assert.equal(r.decision.selected.providerId,'b');assert.equal(r.sources.length,2);
});
test('unresponsive adapter times out, aborts and cannot authorize partial comparison',async()=>{
 let aborted=false;
 const r=await run([{id:'a',quote:async()=>[quote('a')]},{id:'b',quote:(_,{signal})=>{signal.addEventListener('abort',()=>aborted=true);return new Promise(()=>{});}}],{timeoutMs:15});
 assert.equal(r.decision.reason,'incomplete_comparison');assert.equal(r.sources[1].status,'timeout');assert.equal(aborted,true);
});
test('adapter failures are isolated and private error details never leak',async()=>{
 const r=await run([{id:'a',quote:async()=>{throw Error('secret-token');}},{id:'b',quote:async()=>[quote('b')]}]);
 assert.equal(r.quotes.length,1);assert.equal(r.sources[0].status,'unavailable');assert.ok(!JSON.stringify(r).includes('secret-token'));
});
test('wrong source and foreign-order responses are rejected',async()=>{
 for(const q of [quote('other'),{...quote('a'),orderId:'foreign'}]) {
  const r=await run([{id:'a',quote:async()=>[q]}]);assert.equal(r.sources[0].status,'invalid_response');assert.equal(r.quotes.length,0);
 }
 await assert.rejects(run([{id:'a',quote:()=>[]},{id:'a',quote:()=>[]}]),/duplicate/);
});
test('unpaid or cancelled requests do not reach adapters',async()=>{
 let n=0;const a=[{id:'a',quote:()=>{n++;return [];}}];
 assert.equal((await run(a,{order:{...order,paymentState:'pending'}})).decision.reason,'payment_not_confirmed');
 const controller=new AbortController();controller.abort();
 assert.equal((await run(a,{signal:controller.signal})).decision.reason,'quotation_cancelled');assert.equal(n,0);
});
test('offers are rechecked against completion time, not request start time',async()=>{
 let n=0;const r=await run([{id:'a',quote:async()=>[quote('a')]}],{now:()=>n++===0?clock:clock+6000});
 assert.equal(r.decision.status,'review_required');assert.equal(r.decision.rejected[0].reason,'quote_expired_or_invalid');
});
