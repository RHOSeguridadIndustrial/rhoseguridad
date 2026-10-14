import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paymentRuntime} from '../supabase/functions/_shared/payment-runtime.js';
const {default:Stripe}=await import(process.env.STRIPE_TEST_MODULE || 'stripe');
const secret='whsec_local_runtime_fixture';
const session={id:'cs_test_runtime',livemode:false,mode:'payment',payment_status:'paid',
  payment_intent:'pi_runtime',amount_total:29100,currency:'mxn',
  metadata:{rho_request_id:'request_fixture'},client_reference_id:'request_fixture'};
const event={id:'evt_runtime',livemode:false,type:'checkout.session.completed',
  data:{object:{object:'checkout.session',id:session.id}}};
function setup(overrides={}) {
  const calls=[];
  const signer=new Stripe('sk_test_local_fixture');
  class Client {
    constructor(key,options){calls.push(['client',options.apiVersion]);
      this.webhooks=signer.webhooks;
      this.checkout={sessions:{retrieve:async id=>{calls.push(['retrieve',id]);return {...session};}}};}
  }
  const handler=paymentRuntime({Stripe:Client,apiKey:'rk_test_local_fixture',
    signingSecret:secret,enabled:true,
    loadRequest:async id=>{calls.push(['load',id]);return {
      id:'request_fixture',sessionId:id,livemode:false,totalCents:29100};},
    commitPaid:async data=>{calls.push(['commit',data]);return {status:'paid'};},
    ...overrides});
  function request(value=event,alter=false){
    const payload=JSON.stringify(value);
    const signature=signer.webhooks.generateTestHeaderString({payload,secret});
    return new Request('https://local.test/webhook',{method:'POST',
      body:payload+(alter?' ':''),headers:{'stripe-signature':signature}});
  }
  return {handler,calls,request};
}
test('signed event retrieves server session then validates binding before commit',async()=>{
  const f=setup();const response=await f.handler(f.request());
  assert.equal(response.status,200);
  assert.deepEqual(f.calls.map(c=>c[0]),['client','retrieve','load','commit']);
  assert.equal(f.calls[3][1].amountCents,29100);
  assert.equal(f.calls[3][1].eventId,'evt_runtime');
});
test('tampered notification never reads Stripe or the database',async()=>{
  const f=setup();assert.equal((await f.handler(f.request(event,true))).status,400);
  assert.deepEqual(f.calls.map(c=>c[0]),['client']);
});
test('live key, missing signing secret, missing adapter or disabled runtime fail closed',async()=>{
  for(const overrides of [{apiKey:'rk_live_fixture'},{apiKey:'sk_test_fixture'},
    {signingSecret:''},{commitPaid:undefined},{loadRequest:undefined},{enabled:false}]){
    const f=setup(overrides);assert.equal((await f.handler(f.request())).status,503);
    assert.deepEqual(f.calls,[]);
  }
});
test('binding mismatch never commits and remains retryable',async()=>{
  const f=setup({loadRequest:async()=>({id:'wrong',sessionId:session.id,livemode:false,totalCents:29100})});
  assert.equal((await f.handler(f.request())).status,500);
  assert.equal(f.calls.some(c=>c[0]==='commit'),false);
});
test('database outage does not acknowledge a paid event',async()=>{
  const f=setup({commitPaid:async()=>{throw Error('private database detail');}});
  const response=await f.handler(f.request());assert.equal(response.status,500);
  assert.equal((await response.text()).includes('private database detail'),false);
});
