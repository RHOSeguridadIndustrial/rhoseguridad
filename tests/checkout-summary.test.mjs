import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutSummary} from '../checkout-summary.js';
import {createTestCheckout} from '../supabase/functions/_shared/create-test-checkout.js';
const items=[{sku:'test-helmet',quantity:1}];
const valid=()=>({environment:'test',currency:'mxn',lines:[{sku:'test-helmet',name:'Casco',quantity:1,unitPriceCents:6419,lineTotalCents:6419}],
 subtotalCents:6419,shippingCents:9900,totalCents:16319,mode:'standard',coupon:{applied:false,registered:true},expiresAt:1792900000});
test('desglose conserva centavos exactos y admite cantidades agrupadas',()=>{
 assert.equal(checkoutSummary(valid(),items).totalCents,16319);
 const data=valid();data.lines[0].quantity=2;data.lines[0].lineTotalCents=12838;data.subtotalCents=12838;data.totalCents=22738;
 assert.equal(checkoutSummary(data,[...items,...items]).lines[0].quantity,2);
});
test('rechaza desglose incompleto, otro carrito, moneda, suma o cupón inconsistentes',()=>{
 const mutations=[d=>delete d.lines,d=>d.environment='live',d=>d.currency='usd',d=>d.lines=[],
  d=>d.lines[0].sku='other',d=>d.lines[0].quantity=2,d=>d.lines.push({...d.lines[0]}),
  d=>d.lines[0].name='',d=>d.lines[0].unitPriceCents=64.19,d=>d.lines[0].lineTotalCents=6418,
  d=>d.subtotalCents=1,d=>d.shippingCents=-1,d=>d.totalCents++,d=>d.mode='other',
  d=>d.expiresAt=null,d=>d.expiresAt=Number.MAX_SAFE_INTEGER,
  d=>d.coupon.applied='true',d=>d.coupon.applied=true];
 for(const mutate of mutations){const d=valid();mutate(d);assert.throws(()=>checkoutSummary(d,items));}
 assert.throws(()=>checkoutSummary(valid(),[...items,{sku:'extra',quantity:1}]));
 const free=valid();free.shippingCents=0;free.totalCents=6419;free.coupon={applied:true,registered:false};
 assert.throws(()=>checkoutSummary(free,items));
});
test('un registro histórico sin cupón no se presenta como beneficio concedido',()=>{
 const data=valid();data.coupon=null;
 assert.equal(checkoutSummary(data,items).couponApplied,null);
});
for(const method of ['card','transfer'])for(const price of [29899,29900,120000,120001]){
 test(`cotización congelada del servidor llega completa a pantalla: ${method}, ${price}`,async()=>{
  let saved=null,livePrice=price;
  const expiresAt=Math.floor(Date.now()/1000)+2000;
  const input={items,address:{postalCode:'02000'},paymentMethod:method,subtotalCents:1,shippingCents:0};
  const deps={ownerId:'fixture-admin',retryKey:'summary-fixture-key',registered:true,
   validateCoverage:async()=>true,loadVariant:async sku=>({sku,name:'Nombre del servidor',active:true,priceCents:livePrice}),
   loadReservation:async()=>saved,reserve:async x=>saved={...x,id:'fixture-request',livemode:false,expiresAt},bindSession:async()=>{},
   stripe:{checkout:{sessions:{create:async p=>({id:'cs_test_fixture',url:'https://checkout.stripe.com/c/pay/cs_test_fixture',
    amount_total:p.line_items[0].price_data.unit_amount,currency:'mxn',livemode:false,client_reference_id:p.client_reference_id,metadata:p.metadata})}}}};
  const response=await createTestCheckout(input,deps),view=checkoutSummary(response,items);
  assert.equal(view.lines[0].name,'Nombre del servidor');assert.equal(view.subtotalCents,price);
  assert.equal(view.shippingCents,price<29900?9900:0);assert.equal(view.totalCents,price+(price<29900?9900:0));
  assert.equal(view.mode,price>120000?'express':'standard');assert.equal(view.couponApplied,price>=29900);
  assert.equal(view.expiresAt,expiresAt);
  livePrice=99999;assert.deepEqual(checkoutSummary(await createTestCheckout(input,deps),items),view);
 });
}
