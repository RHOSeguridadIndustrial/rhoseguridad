import {test} from 'node:test';
import assert from 'node:assert/strict';
import {quoteCheckout} from '../supabase/functions/_shared/checkout-quote.js';
const deps={validateCoverage:async a=>a?.postalCode==='02000',
  loadVariant:async sku=>sku==='cone'?{sku,name:'Cono de seguridad 45 cm',priceCents:19200,active:true}:null};
const input={address:{postalCode:'02000'},items:[{sku:'cone',quantity:1}]};
test('browser prices, totals, names and shipping cannot alter server quote',async()=>{
  const q=await quoteCheckout({...input,totalCents:1,shippingCents:0,
    items:[{sku:'cone',quantity:1,priceCents:1,name:'forged'}]},deps);
  assert.equal(q.totalCents,29100);assert.equal(q.shippingCents,9900);
  assert.equal(q.lines[0].name,'Cono de seguridad 45 cm');
  assert.equal(q.lines[0].unitPriceCents,19200);
});
test('duplicate exact variants aggregate before pricing',async()=>{
  const q=await quoteCheckout({...input,items:[...input.items,...input.items]},deps);
  assert.equal(q.lines.length,1);assert.equal(q.lines[0].quantity,2);
  assert.equal(q.totalCents,38400);assert.equal(q.shippingCents,0);
});
test('invalid or excessive quantities fail before catalog access',async()=>{
  for(const quantity of [0,-1,1.1,'1',1000001])
    await assert.rejects(quoteCheckout({...input,items:[{sku:'cone',quantity}]},deps));
  await assert.rejects(quoteCheckout({...input,items:[{sku:'cone',quantity:1000000},{sku:'cone',quantity:1}]},deps));
});
test('coverage requires explicit trusted approval',async()=>{
  await assert.rejects(quoteCheckout({...input,address:{postalCode:'99999',city:'Ciudad de México'}},deps),/coverage/);
  await assert.rejects(quoteCheckout(input,{...deps,validateCoverage:async()=>({allowed:true})}),/coverage/);
});
test('unknown inactive or mismatched variants and malformed prices fail',async()=>{
  for(const variant of [null,{sku:'other',name:'Cono',priceCents:19200,active:true},
    {sku:'cone',name:'Cono',priceCents:19200,active:false},
    {sku:'cone',name:'Cono',priceCents:NaN,active:true}])
    await assert.rejects(quoteCheckout(input,{...deps,loadVariant:async()=>variant}),/catalog/);
});
test('express threshold derives only from trusted subtotal',async()=>{
  const q=await quoteCheckout({...input,items:[{sku:'cone',quantity:7}]},deps);
  assert.equal(q.mode,'express');assert.equal(q.shippingCents,0);assert.equal(q.totalCents,134400);
});
