import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stripeTestNotification} from '../supabase/functions/_shared/stripe-test-notification.js';
const {default:Stripe}=await import(process.env.STRIPE_TEST_MODULE||'stripe');
const secret='whsec_diagnostic_fixture';
function setup(options={}) {
  let reads=0;
  const signer=new Stripe('sk_test_fixture');
  class Client {
    constructor(){this.webhooks=signer.webhooks;this.checkout={sessions:{retrieve:async id=>{
      reads++;return {id,livemode:false,mode:'payment',...options.session};
    }}};}
  }
  const handler=stripeTestNotification({Stripe:Client,apiKey:options.apiKey||'rk_test_fixture',
    signingSecret:options.noSecret?'':secret});
  const request=(change={},tamper=false)=>{
    const payload=JSON.stringify({id:'evt_diagnostic',livemode:false,type:'checkout.session.completed',
      data:{object:{object:'checkout.session',id:'cs_test_diagnostic'}},...change});
    return new Request('https://local.test',{method:'POST',body:payload+(tamper?' ':''),
      headers:{'stripe-signature':signer.webhooks.generateTestHeaderString({payload,secret})}});
  };
  return {handler,request,reads:()=>reads};
}
test('verified sandbox session confirms connectivity without fulfillment',async()=>{
  const f=setup();const r=await f.handler(f.request());assert.equal(r.status,200);
  assert.equal((await r.json()).status,'verified_test_notification_no_fulfillment');assert.equal(f.reads(),1);
});
test('tampered and live notifications do not retrieve sessions',async()=>{
  for(const [change,tamper] of [[{},true],[{livemode:true},false]]){
    const f=setup();assert.equal((await f.handler(f.request(change,tamper))).status,400);assert.equal(f.reads(),0);
  }
});
test('missing signing secret and live key keep receiver disabled',async()=>{
  for(const opts of [{noSecret:true},{apiKey:'rk_live_fixture'}]){
    const f=setup(opts);assert.equal((await f.handler(f.request())).status,503);assert.equal(f.reads(),0);
  }
});
test('session mismatch fails and unrelated event never retrieves session',async()=>{
  const f=setup({session:{id:'cs_test_wrong'}});assert.equal((await f.handler(f.request())).status,500);
  const g=setup();assert.equal((await g.handler(g.request({type:'checkout.session.expired'}))).status,200);
  assert.equal(g.reads(),0);
});
