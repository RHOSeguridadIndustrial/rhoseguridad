import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paymentWebhook} from '../supabase/functions/_shared/payment-webhook.js';
const {default:Stripe}=await import(process.env.STRIPE_TEST_MODULE||'stripe');
// Synthetic keys are used only for local signature tests. No Stripe network call.
const stripe=new Stripe('sk_test_local_fixture_not_an_api_key');
const secret='whsec_local_fixture_not_a_real_endpoint';
const body=JSON.stringify({id:'evt_fixture',type:'checkout.session.completed',livemode:false,
  data:{object:{id:'cs_test_fixture',payment_status:'paid'}}});
function setup(){
  const seen=[];
  const handler=paymentWebhook({configured:true,
    verifyEvent:(raw,sig)=>stripe.webhooks.constructEventAsync(raw,sig,secret),
    handleEvent:async event=>{seen.push(event);return {status:'paid'};}});
  return {handler,seen};
}
function req(payload=body,header=stripe.webhooks.generateTestHeaderString({payload:body,secret})) {
  return new Request('https://local.test/webhook',{method:'POST',body:payload,
    headers:header?{'stripe-signature':header}:{}});
}
test('valid SDK signature reaches confirmation',async()=>{
  const f=setup();assert.equal((await f.handler(req())).status,200);assert.equal(f.seen.length,1);
});
test('modified raw body rejected before database handling',async()=>{
  const f=setup();assert.equal((await f.handler(req(body+' '))).status,400);assert.equal(f.seen.length,0);
});
test('wrong signing secret rejected',async()=>{
  const f=setup();const sig=stripe.webhooks.generateTestHeaderString({payload:body,secret:'whsec_wrong_fixture'});
  assert.equal((await f.handler(req(body,sig))).status,400);assert.equal(f.seen.length,0);
});
test('missing and expired signatures rejected',async()=>{
  const f=setup();assert.equal((await f.handler(req(body,null))).status,400);
  const sig=stripe.webhooks.generateTestHeaderString({payload:body,secret,timestamp:Math.floor(Date.now()/1000)-600});
  assert.equal((await f.handler(req(body,sig))).status,400);assert.equal(f.seen.length,0);
});
test('missing configuration fails closed',async()=>{
  assert.equal((await paymentWebhook({})(req())).status,503);
});
test('database error remains retryable without leaking details',async()=>{
  const handler=paymentWebhook({configured:true,verifyEvent:async()=>({}),handleEvent:async()=>{throw Error('private detail');}});
  const response=await handler(req());assert.equal(response.status,500);
  assert.equal((await response.text()).includes('private detail'),false);
});
