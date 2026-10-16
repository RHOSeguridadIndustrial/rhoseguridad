import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testOrderStatusHandler} from '../supabase/functions/test-order-status/handler.js';
const request=(body={environment:'test',sessionId:'cs_test_example'},headers={authorization:'Bearer fixture'})=>new Request('https://local.test',{method:'POST',body:JSON.stringify(body),headers});
test('anonymous, foreign origins, live identifiers cannot read orders',async()=>{
 let reads=0;const h=testOrderStatusHandler({authorize:async()=>null,load:async()=>{reads++}});
 assert.equal((await h(request({},{}))).status,401);
 assert.equal((await h(request(undefined,{origin:'https://evil.test'}))).status,403);
 const admin=testOrderStatusHandler({authorize:async()=>'owner',load:async()=>{reads++}});
 assert.equal((await admin(request({environment:'test',sessionId:'cs_live_example'}))).status,400);
 assert.equal(reads,0);
});
test('owner always comes from authentication, never browser',async()=>{
 const h=testOrderStatusHandler({authorize:async()=>'actual-owner',load:async(owner,id)=>{assert.equal(owner,'actual-owner');assert.equal(id,'cs_test_example');return null;}});
 assert.equal((await h(request({environment:'test',sessionId:'cs_test_example',ownerId:'someone-else'}))).status,404);
});
test('pending, reconciliation and paid records returned without mutations',async()=>{
 for(const state of ['pending','reconciliation_required','paid']){
 const h=testOrderStatusHandler({authorize:async()=>'owner',load:async()=>({environment:'test',state,orderId:state==='paid'?'3':null})});
 const r=await h(request());assert.equal(r.status,200);assert.equal((await r.json()).state,state);assert.equal(r.headers.get('cache-control'),'no-store');
 }
});
test('lookup failures and invalid database environments fail closed',async()=>{
 for(const load of [async()=>{throw Error('private detail')},async()=>({environment:'live'})]){
 const r=await testOrderStatusHandler({authorize:async()=>'owner',load})(request());assert.equal(r.status,503);assert.doesNotMatch(await r.text(),/private detail/);
 }
});
test('preflight accepts Supabase SDK headers',async()=>{
 const r=await testOrderStatusHandler({})(new Request('https://local.test',{method:'OPTIONS'}));assert.equal(r.status,204);assert.match(r.headers.get('access-control-allow-headers'),/x-client-info/);
});
