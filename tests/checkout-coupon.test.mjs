import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteCheckout} from '../supabase/functions/_shared/checkout-quote.js';
import {createTestCheckout} from '../supabase/functions/_shared/create-test-checkout.js';
import {testCheckoutHandler} from '../supabase/functions/create-test-checkout/handler.js';
const input=(method='card')=>({environment:'test',items:[{sku:'test-sku',quantity:1}],address:{postalCode:'02000'},paymentMethod:method,retryKey:'coupon-test-key-1234'});
function deps(price=29900){
 let saved=null, creates=0;
 return {ownerId:'test-owner',retryKey:'coupon-test-key-1234',registered:true,
 loadVariant:async sku=>({sku,name:'Prueba',active:true,priceCents:price}),validateCoverage:async a=>a.postalCode==='02000',
 loadReservation:async()=>saved,
 reserve:async x=>saved={...x,id:'test-request',expiresAt:Math.floor(Date.now()/1000)+2000,livemode:false},
 bindSession:async()=>{},
 stripe:{checkout:{sessions:{create:async p=>{creates++;return {id:'cs_test_coupon',url:'https://checkout.stripe.com/c/pay/cs_test_coupon',livemode:false,amount_total:p.line_items[0].price_data.unit_amount,currency:'mxn',client_reference_id:p.client_reference_id,metadata:p.metadata};}}}},
 saved:()=>saved,creates:()=>creates};
}
for(const method of ['card','transfer'])test(`cupón guardado en pedido ${method}`,async()=>{
 const d=deps();const r=await createTestCheckout(input(method),d);
 assert.equal(r.totalCents,29900);assert.equal(r.coupon.applied,true);
 assert.equal(d.saved().quote.coupon.policyVersion,'2026-10-22');
 assert.equal(d.saved().quote.paymentMethod,method);
 assert.equal(d.creates(),method==='card'?1:0);
 if(method==='transfer'){assert.equal(r.status,'awaiting_test_transfer');assert.equal(r.url,undefined);}
});
test('precios y cupón del navegador se ignoran',async()=>{
 const d=deps(29899);const r=await createTestCheckout({...input(),subtotalCents:120001,registered:true,coupon:{applied:true},shippingCents:0},d);
 assert.equal(r.totalCents,39799);assert.equal(r.coupon.applied,false);
});
test('sin registro servidor no concede beneficio',async()=>{
 await assert.rejects(quoteCheckout({...input(),registered:true},{...deps(),registered:false}));
});
test('cobertura y catálogo no válidos bloquean',async()=>{
 await assert.rejects(quoteCheckout(input(),{...deps(),validateCoverage:async()=>false}));
 await assert.rejects(quoteCheckout(input(),{...deps(),loadVariant:async()=>null}));
});
test('reintento congela precio y referencia de transferencia',async()=>{
 const d=deps();const a=await createTestCheckout(input('transfer'),d);
 d.loadVariant=async()=>{throw Error('must use saved quote')};
 const b=await createTestCheckout(input('transfer'),d);assert.deepEqual(b,a);
});
test('cambiar método con misma clave no reutiliza pedido',async()=>{
 const d=deps();await createTestCheckout(input('transfer'),d);
 await assert.rejects(createTestCheckout(input('card'),d),/Retry changed/);
});
test('reintento de tarjeta legado mantiene identidad',async()=>{
 const d=deps();const old=input();delete old.paymentMethod;
 await createTestCheckout(old,d);await createTestCheckout(input('card'),d);
 assert.ok(!JSON.parse(d.saved().checkoutIdentity).paymentMethod);
});
test('cantidades cambiadas, reserva expirada o de otro dueño se rechazan',async()=>{
 const d=deps();await createTestCheckout(input('transfer'),d);
 await assert.rejects(createTestCheckout({...input('transfer'),items:[{sku:'test-sku',quantity:2}]},d));
 d.saved().ownerId='other';await assert.rejects(createTestCheckout(input('transfer'),d));
 d.saved().ownerId='test-owner';d.saved().expiresAt=1;await assert.rejects(createTestCheckout(input('transfer'),d));
});
test('endpoint exige autenticación y entorno de prueba',async()=>{
 const d=deps();let owner=null;
 const handler=testCheckoutHandler({...d,quoteDeps:d,configured:true,authorize:async()=>owner});
 const req=body=>new Request('https://rho.test',{method:'POST',headers:{origin:'https://rhosegind.com',authorization:'Bearer test'},body:JSON.stringify(body)});
 assert.equal((await handler(req(input()))).status,401);owner='test-owner';
 assert.equal((await handler(req({...input(),environment:'live'}))).status,400);
 assert.equal((await handler(req({...input(),paymentMethod:'cash'}))).status,400);
 assert.equal((await handler(req({...input(),address:{postalCode:'02140'}}))).status,400);
 assert.equal((await handler(req(input('transfer')))).status,200);
});
