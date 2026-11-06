// Synthetic Stripe responses and in-memory persistence only; no remote payments.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import Stripe from 'stripe';
import {createCardCheckout} from '../supabase/functions/_shared/create-card-checkout.js';
import {cardPaymentRuntime} from '../supabase/functions/_shared/card-payment-runtime.js';

const clock = 1793966400000;
const owner = '11111111-1111-4111-8111-111111111111';
const retry = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const address = {country:'MX',state:'CMX',postalCode:'02000',municipalityCode:'002',
  settlementCode:'0001',street:'Calle de prueba',exterior:'10',interior:'',reference:''};
function input(extra={}) {return {paymentMethod:'card',items:[{sku:'fixture-sku',quantity:2}],
  contact:{name:'Comprador de prueba',phone:'5555555555'},address:structuredClone(address),expectedTotalCents:10564,...extra};}
function quote() {return {currency:'mxn',paymentMethod:'card',
  lines:[{sku:'fixture-sku',name:'Artículo sintético',quantity:2,unitPriceCents:332,lineTotalCents:664}],
  subtotalCents:664,shippingCents:9900,totalCents:10564,mode:'standard',
  delivery:{status:'postal_match',assurance:'postal_catalog_only',catalogSha256:'a'.repeat(64),
    address:{...address,municipality:'Azcapotzalco',settlement:'Centro'}}};}

function fixture() {
  const calls = {quotes:0,reserves:0,creates:[],bindings:[]};
  let saved = null, bindingFailure = false, networkFailure = false;
  let mutateReservation = value=>value, mutateSession = value=>value, nextQuote = quote;
  const deps = {enabled:true,ownerId:owner,retryKey:retry,now:()=>clock,
    quoteBuilder:async()=>{calls.quotes++;return nextQuote();},
    loadReservation:async()=>saved && structuredClone(saved),
    reserve:async data=>{calls.reserves++;saved = mutateReservation({...structuredClone(data),
      id:requestId,expiresAt:clock/1000+3600});return structuredClone(saved);},
    bindSession:async data=>{if(bindingFailure)throw Error('database unavailable');calls.bindings.push(data);},
    stripe:{checkout:{sessions:{create:async(params,options)=>{
      calls.creates.push(structuredClone({params,options}));
      if(networkFailure)throw Error('unknown network outcome');
      return mutateSession({id:'cs_live_synthetic',url:'https://checkout.stripe.com/c/pay/cs_live_synthetic',
        livemode:true,status:'open',mode:'payment',payment_status:'unpaid',amount_total:params.line_items[0].price_data.unit_amount,
        currency:'mxn',client_reference_id:params.client_reference_id,metadata:params.metadata,expires_at:params.expires_at});
    }}}}
  };
  return {deps,calls,get saved(){return saved;},set saved(value){saved=value;},
    quote:fn=>{nextQuote=fn;},reservation:fn=>{mutateReservation=fn;},session:fn=>{mutateSession=fn;},
    bindingFailure:value=>{bindingFailure=value;},networkFailure:value=>{networkFailure=value;}};
}

test('live core is disabled by default and rejects incomplete persistence before Stripe',async()=>{
  for(const change of [{enabled:undefined},{enabled:false},{bindSession:null},{loadReservation:null},{ownerId:''}]) {
    const f=fixture();await assert.rejects(createCardCheckout(input(),{...f.deps,...change}));
    assert.equal(f.calls.creates.length,0);assert.equal(f.calls.reserves,0);
  }
});
test('server total includes shipping; approved parameters and reservation binding survive',async()=>{
  const f=fixture(), result=await createCardCheckout(input({total:1,ownerId:'attacker',environment:'test'}),f.deps);
  assert.equal(result.totalCents,10564);assert.equal(result.shippingCents,9900);
  const {params,options}=f.calls.creates[0];
  assert.equal(params.line_items[0].price_data.unit_amount,10564);
  assert.equal(params.client_reference_id,requestId);assert.deepEqual(params.metadata,{rho_request_id:requestId,environment:'live'});
  assert.equal(params.ui_mode,'hosted_page');assert.equal(params.integration_identifier,'hosted_web_0001');
  assert.equal(params.origin_context,'web');assert.deepEqual(params.automatic_tax,{enabled:false});
  assert.deepEqual(params.adaptive_pricing,{enabled:false});assert.equal(params.payment_method_types,undefined);
  assert.deepEqual(options,{idempotencyKey:`rho-live-${requestId}`});
  assert.deepEqual(f.calls.bindings,[{requestId,ownerId:owner,sessionId:'cs_live_synthetic',livemode:true}]);
});
test('amount changes require acceptance before any reservation or payment request',async()=>{
  const f=fixture();await assert.rejects(createCardCheckout(input({expectedTotalCents:664}),f.deps),/Card total changed/);
  assert.equal(f.calls.reserves,0);assert.equal(f.calls.creates.length,0);
});
test('missing acceptance, invalid address and invalid carts never reach Stripe',async()=>{
  for(const change of [{expectedTotalCents:undefined},{items:[]},{paymentMethod:'transfer'},{contact:null},{contact:{name:'A',phone:'123'}},
    {items:[{sku:'fixture-sku',quantity:1.5}]},{items:[{sku:'fixture-sku',quantity:101}]},{address:{postalCode:'02000'}}]) {
    const f=fixture();await assert.rejects(createCardCheckout(input(change),f.deps));assert.equal(f.calls.creates.length,0);
  }
});
test('price, quantity, shipment and delivery mismatches in server snapshots fail closed',async()=>{
  for(const change of [{shippingCents:0,totalCents:664},{totalCents:1},{mode:'express'},
    {lines:[{...quote().lines[0],quantity:3}]},{delivery:{...quote().delivery,address:{...address,exterior:'99'}}}]) {
    const f=fixture();f.quote(()=>({...quote(),...change}));
    await assert.rejects(createCardCheckout(input(),f.deps));assert.equal(f.calls.creates.length,0);
  }
});
test('retries use frozen prices, expiration and idempotency key after unknown network outcome',async()=>{
  const f=fixture();f.networkFailure(true);
  await assert.rejects(createCardCheckout(input(),f.deps),/unknown network/);
  assert.ok(f.saved);assert.equal(f.calls.bindings.length,0);
  f.networkFailure(false);f.quote(()=>{throw Error('must not reprice');});
  await createCardCheckout(input(),f.deps);
  assert.equal(f.calls.reserves,1);assert.equal(f.calls.quotes,1);
  assert.deepEqual(f.calls.creates[0],f.calls.creates[1]);
});
test('failed session binding prevents redirect and can be retried with identical Stripe request',async()=>{
  const f=fixture();f.bindingFailure(true);
  await assert.rejects(createCardCheckout(input(),f.deps),/database unavailable/);
  f.bindingFailure(false);await createCardCheckout(input(),f.deps);
  assert.deepEqual(f.calls.creates[0],f.calls.creates[1]);assert.equal(f.calls.reserves,1);
});
test('retry key cannot be reused for another cart or owner',async()=>{
  const f=fixture();await createCardCheckout(input(),f.deps);
  await assert.rejects(createCardCheckout(input({items:[{sku:'fixture-sku',quantity:3}]}),f.deps));
  await assert.rejects(createCardCheckout(input({contact:{name:'Otro receptor',phone:'5555555555'}}),f.deps));
  await assert.rejects(createCardCheckout(input(),{...f.deps,ownerId:'44444444-4444-4444-8444-444444444444'}));
  assert.equal(f.calls.creates.length,1);
});
test('test reservations, expired holds and changed frozen quotes cannot create live sessions',async()=>{
  for(const change of [{environment:'test'},{livemode:false},{integrationVersion:'old'},
    {expiresAt:clock/1000},{quote:{...quote(),totalCents:1}}]) {
    const f=fixture();f.reservation(r=>({...r,...change}));
    await assert.rejects(createCardCheckout(input(),f.deps));assert.equal(f.calls.creates.length,0);
  }
});
test('wrong Stripe environment, amount, identity or redirect is never bound or returned',async()=>{
  for(const change of [{livemode:false},{id:'cs_test_synthetic'},{amount_total:1},{currency:'usd'},
    {client_reference_id:'other'},{metadata:{rho_request_id:requestId,environment:'test'}},
    {url:'https://checkout.stripe.com.attacker.invalid/c/pay/cs_live_synthetic'},
    {url:'https://checkout.stripe.com/c/pay/cs_live_other'},{expires_at:clock/1000+3601},
    {status:'complete'},{payment_status:'paid'}]) {
    const f=fixture();f.session(s=>({...s,...change}));
    await assert.rejects(createCardCheckout(input(),f.deps));assert.equal(f.calls.bindings.length,0);
  }
});

// Real Stripe SDK verifies synthetic signatures; the API and persistence are stubs.
const signingSecret='whsec_synthetic_fixture_only';
const apiKey=['rk','live','synthetic_fixture_only'].join('_');
const sdk=new Stripe(apiKey,{apiVersion:'2026-08-26.dahlia'});
function webhookFixture() {
  let reads=0,commits=0,commitFailure=false;
  let session={id:'cs_live_synthetic',object:'checkout.session',livemode:true,mode:'payment',
    payment_status:'paid',payment_intent:'pi_synthetic',amount_total:10564,currency:'mxn',
    client_reference_id:requestId,metadata:{rho_request_id:requestId,environment:'live'}};
  let reservation={id:requestId,sessionId:session.id,livemode:true,totalCents:10564,
    environment:'live',integrationVersion:'card-checkout-v1'};
  const deps={enabled:true,apiKey,signingSecret,
    Stripe:function(){return {webhooks:sdk.webhooks,checkout:{sessions:{retrieve:async()=>{reads++;return session;}}}};},
    loadRequest:async()=>reservation,
    commitPaid:async value=>{commits++;assert.equal(value.livemode,true);if(commitFailure)throw Error('db error');return {status:'paid'};}};
  const handler=cardPaymentRuntime(deps);
  const send=async({tamper=false,wrongSecret=false,eventChange={},bodyChange={}}={})=>{
    const event={id:'evt_synthetic',object:'event',livemode:true,type:'checkout.session.completed',
      data:{object:{object:'checkout.session',id:'cs_live_synthetic',...bodyChange}},...eventChange};
    const raw=JSON.stringify(event),signature=sdk.webhooks.generateTestHeaderString({payload:raw,
      secret:wrongSecret?'whsec_wrong':signingSecret});
    return handler(new Request('https://fixture.invalid',{method:'POST',headers:{'stripe-signature':signature},body:raw+(tamper?' ':'')}));
  };
  return {deps,send,get reads(){return reads;},get commits(){return commits;},
    session:change=>{session={...session,...change};},reservation:change=>{reservation={...reservation,...change};},
    failCommit:()=>{commitFailure=true;}};
}
test('production webhook rejects test credentials and defaults to disabled',async()=>{
  const f=webhookFixture();
  for(const change of [{enabled:false},{enabled:undefined},{Stripe:null},{apiKey:'rk_test_fixture'},{signingSecret:''},{commitPaid:null}]) {
    const response=await cardPaymentRuntime({...f.deps,...change})(new Request('https://fixture.invalid',{method:'POST'}));
    assert.equal(response.status,503);
  }
});
test('invalid signatures and altered raw bodies cannot read Stripe or write orders',async()=>{
  const f=webhookFixture();
  assert.equal((await f.send({tamper:true})).status,400);assert.equal((await f.send({wrongSecret:true})).status,400);
  assert.equal(f.reads,0);assert.equal(f.commits,0);
});
test('signed test-mode events and test session IDs cannot enter live fulfillment',async()=>{
  const f=webhookFixture();
  assert.equal((await f.send({eventChange:{livemode:false}})).status,500);
  assert.equal((await f.send({bodyChange:{id:'cs_test_synthetic'}})).status,500);
  assert.equal(f.reads,0);assert.equal(f.commits,0);
});
test('authoritative Stripe mismatches cannot commit payments',async()=>{
  for(const change of [{livemode:false},{amount_total:1},{currency:'usd'},{client_reference_id:'other'},
    {metadata:{rho_request_id:requestId,environment:'test'}},{payment_intent:null}]) {
    const f=webhookFixture();f.session(change);assert.equal((await f.send()).status,500);assert.equal(f.commits,0);
  }
  const f=webhookFixture();f.reservation({environment:'test'});
  assert.equal((await f.send()).status,500);assert.equal(f.commits,0);
});
test('pending and unrelated signed notifications never create orders',async()=>{
  const f=webhookFixture();f.session({payment_status:'unpaid'});
  assert.equal((await (await f.send()).json()).status,'pending');assert.equal(f.commits,0);
  assert.equal((await (await f.send({eventChange:{type:'checkout.session.async_payment_failed'}})).json()).status,'ignored');
  assert.equal(f.commits,0);
});
test('both successful event types call the atomic adapter; database failure remains retryable',async()=>{
  for(const type of ['checkout.session.completed','checkout.session.async_payment_succeeded']) {
    const f=webhookFixture();assert.equal((await (await f.send({eventChange:{type}})).json()).status,'paid');
    assert.equal(f.commits,1);
  }
  const f=webhookFixture();f.failCommit();assert.equal((await f.send()).status,500);
});
