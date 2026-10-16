import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestCheckout} from '../supabase/functions/_shared/create-test-checkout.js';
const input={items:[{sku:'cone',quantity:1,price:0.01}],address:{postalCode:'02000'},ownerId:'forged'};
function fixture(change={}) {
 const calls=[];
 return {calls,deps:{ownerId:'server-owner',retryKey:'retry_key_fixture_123',
  loadVariant:async sku=>({sku,name:'Cono',active:true,priceCents:19200}),
  validateCoverage:async()=>true,
  reserve:async p=>{calls.push(['reserve',p]);return {id:'request_fixture',quote:p.quote,expiresAt:2000000000,livemode:false}},
  bindSession:async p=>calls.push(['bind',p]),
  stripe:{checkout:{sessions:{create:async(p,o)=>{calls.push(['stripe',p,o]);return {
    id:'cs_test_cart',url:'https://checkout.stripe.com/c/pay/cs_test_cart',livemode:false,
    amount_total:p.line_items[0].price_data.unit_amount,currency:'mxn',
    client_reference_id:p.client_reference_id,metadata:p.metadata,...change};}}}}}};
}
test('server prices and owner bind cart to test session before returning redirect',async()=>{
 const f=fixture();const r=await createTestCheckout(input,f.deps);
 assert.equal(r.totalCents,29100);assert.equal(r.environment,'test');
 assert.equal(f.calls[0][1].ownerId,'server-owner');
 assert.equal(f.calls[1][1].metadata.rho_request_id,'request_fixture');
 assert.equal(f.calls[2][0],'bind');
 assert.equal(f.calls[1][1].success_url,'https://rhosegind.com/confirmacion-prueba.html?session_id={CHECKOUT_SESSION_ID}');
});
test('retry repeats identical Stripe idempotency key and payload',async()=>{
 const f=fixture();await createTestCheckout(input,f.deps);await createTestCheckout(input,f.deps);
 assert.deepEqual(f.calls[1],f.calls[4]);
});
test('live mode, forged amount, mismatched binding and unsafe redirect cannot bind',async()=>{
 for(const c of [{livemode:true},{amount_total:1},{client_reference_id:'wrong'},
   {url:'https://checkout.stripe.com.evil.example/c/pay/cs_test_cart'}]) {
  const f=fixture(c);await assert.rejects(createTestCheckout(input,f.deps));
  assert.equal(f.calls.some(c=>c[0]==='bind'),false);
 }
});
test('reservation failure never creates Stripe session; bind failure never returns URL',async()=>{
 const f=fixture();f.deps.reserve=async()=>{throw Error('insufficient test stock')};
 await assert.rejects(createTestCheckout(input,f.deps));assert.equal(f.calls.length,0);
 const g=fixture();g.deps.bindSession=async()=>{throw Error('database unavailable')};
 await assert.rejects(createTestCheckout(input,g.deps),/database unavailable/);
});

test('database JSON key order does not reject an unchanged quote',async()=>{
 const f=fixture();const reserve=f.deps.reserve;
 f.deps.reserve=async p=>{const r=await reserve(p);r.quote=Object.fromEntries(Object.entries(r.quote).reverse());return r;};
 assert.equal((await createTestCheckout(input,f.deps)).totalCents,29100);
});
