import test from 'node:test';
import assert from 'node:assert/strict';
import {testCheckoutRpc,ExpiredTestTransfer} from '../supabase/functions/_shared/test-checkout-rpc.js';
import {testCheckoutHandler} from '../supabase/functions/create-test-checkout/handler.js';
const body={environment:'test',paymentMethod:'transfer',retryKey:'expired-fixture-key',items:[{sku:'test-sku',quantity:1}],address:{postalCode:'02000'}};
test('only the designated database code and reservation operations expose expiry',async()=>{
 for(const name of ['qw10_test_load_reservation','qw10_test_reserve_v2']){
  const rpc=testCheckoutRpc({rpc:async()=>({error:{code:'PQT01',message:'private detail'}})});
  await assert.rejects(rpc(name,{}),ExpiredTestTransfer);
 }
 for(const [name,code] of [['qw10_test_bind','PQT01'],['qw10_test_load_reservation','P0001'],['qw10_test_load_reservation','42501']]){
  await assert.rejects(testCheckoutRpc({rpc:async()=>({error:{code,message:'private detail'}})})(name,{}),e=>!(e instanceof ExpiredTestTransfer)&&e.message==='Test database error');
 }
});
test('410 requires authenticated transfer and typed expiry; no quote, reservation or Stripe calls',async()=>{
 let owner='fixture-admin',typed=true,calls=0;
 const forbidden=async()=>{calls++;throw Error('must not run');};
 const handler=testCheckoutHandler({configured:true,authorize:async()=>owner,
  loadReservation:async()=>{throw typed?new ExpiredTestTransfer():Error('private detail');},
  quoteDeps:{loadVariant:forbidden,validateCoverage:forbidden},reserve:forbidden,bindSession:forbidden,stripe:{}});
 const req=(overrides={})=>new Request('https://rho.test',{method:'POST',headers:{origin:'https://rhosegind.com',authorization:'Bearer synthetic'},body:JSON.stringify({...body,...overrides})});
 let response=await handler(req());assert.equal(response.status,410);assert.deepEqual(await response.json(),{error:'test_transfer_expired'});
 assert.equal((await handler(req({paymentMethod:'card'}))).status,409);
 typed=false;response=await handler(req());assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:'test_checkout_not_created'});
 owner=null;assert.equal((await handler(req())).status,401);assert.equal(calls,0);
});
