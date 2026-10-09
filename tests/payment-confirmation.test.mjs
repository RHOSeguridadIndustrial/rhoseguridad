import {test} from 'node:test';
import assert from 'node:assert/strict';
import {confirmPayment,automaticShipping} from '../supabase/functions/_shared/payment-confirmation.js';
const event={id:'evt_test',type:'checkout.session.completed',livemode:false,
  data:{object:{object:'checkout.session',id:'cs_test_fixture'}}};
const session={id:'cs_test_fixture',livemode:false,mode:'payment',payment_status:'paid',
  payment_intent:'pi_fixture',amount_total:29100,currency:'mxn',
  metadata:{rho_request_id:'fixture'},client_reference_id:'fixture'};
const request={id:'fixture',sessionId:session.id,livemode:false,totalCents:29100};
function fixture(overrides={}) {
  const calls=[];
  return {calls,options:{retrieveSession:async()=>({...session,...overrides}),
    loadRequest:async()=>request,commitPaid:async data=>{calls.push(data);return {status:'paid'};}}};
}
test('paid session sends validated identities to atomic commit',async()=>{
  const f=fixture();assert.deepEqual(await confirmPayment(event,f.options),{status:'paid'});
  assert.equal(f.calls[0].amountCents,29100);assert.equal(f.calls[0].paymentIntentId,'pi_fixture');
});
test('unpaid session cannot generate order',async()=>{
  const f=fixture({payment_status:'unpaid'});assert.deepEqual(await confirmPayment(event,f.options),{status:'pending'});
  assert.equal(f.calls.length,0);
});
test('reject wrong amount and currency',async()=>{
  for(const change of [{amount_total:19200},{currency:'usd'}]) {
    const f=fixture(change);await assert.rejects(confirmPayment(event,f.options),/total mismatch/);assert.equal(f.calls.length,0);
  }
});
test('reject live payment in test environment',async()=>{
  const f=fixture({livemode:true});await assert.rejects(confirmPayment(event,f.options),/checkout state/);
  await assert.rejects(confirmPayment({...event,livemode:true},f.options),/environment/);
});
test('reject unbound session or modified reference',async()=>{
  const f=fixture({client_reference_id:'other'});await assert.rejects(confirmPayment(event,f.options),/request mismatch/);
  f.options.loadRequest=async()=>null;await assert.rejects(confirmPayment(event,f.options),/request mismatch/);
});
test('asynchronous success follows same confirmation path',async()=>{
  const f=fixture();await confirmPayment({...event,type:'checkout.session.async_payment_succeeded'},f.options);
  assert.equal(f.calls.length,1);
});
test('failed and expired notices never confirm payment',async()=>{
  const f=fixture();for(const type of ['checkout.session.async_payment_failed','checkout.session.expired'])
    assert.deepEqual(await confirmPayment({...event,type},f.options),{status:'ignored'});
  assert.equal(f.calls.length,0);
});
test('database failure propagates for Stripe retry',async()=>{
  const f=fixture();f.options.commitPaid=async()=>{throw Error('database unavailable');};
  await assert.rejects(confirmPayment(event,f.options),/database unavailable/);
});
test('automatic shipping exact thresholds',()=>{
  assert.deepEqual(automaticShipping(19200),{mode:'standard',shippingCents:9900,totalCents:29100});
  assert.equal(automaticShipping(29899).shippingCents,9900);
  assert.equal(automaticShipping(29900).shippingCents,0);
  assert.equal(automaticShipping(120000).mode,'standard');
  assert.equal(automaticShipping(120001).mode,'express');
  for(const value of [-1,NaN,Infinity,'29900',1.2])assert.throws(()=>automaticShipping(value));
});
