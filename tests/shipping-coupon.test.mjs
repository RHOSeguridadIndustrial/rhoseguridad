import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../shipping-coupon.js',import.meta.url),'utf8');
const {shippingCoupon}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const quote=(subtotalCents,overrides={})=>shippingCoupon({subtotalCents,registered:true,paymentMethod:'card',coverage:'cdmx',...overrides});
for(const method of ['card','transfer']) test(`montos exactos con ${method}`,()=>{
 assert.equal(quote(29899,{paymentMethod:method}).totalCents,39799);
 assert.equal(quote(29900,{paymentMethod:method}).shippingCents,0);
 assert.equal(quote(120000,{paymentMethod:method}).mode,'standard');
 assert.equal(quote(120001,{paymentMethod:method}).mode,'express');
});
test('registro no comprobado no promete envío gratis ni inventa tarifa',()=>{
 for(const registered of [false,undefined,'true']) assert.equal(quote(29900,{registered}).totalCents,null);
 assert.equal(quote(29899,{registered:false}).shippingCents,9900);
});
test('métodos no admitidos no calculan beneficio',()=>{for(const paymentMethod of ['','cash','paypal'])assert.equal(quote(40000,{paymentMethod}).reason,'payment');});
test('sin cobertura verificada o pedido especial no aplica',()=>{
 assert.equal(quote(40000,{coverage:'unknown'}).reason,'coverage');
 assert.equal(quote(40000,{coverage:'edomex'}).reason,'coverage');
 assert.equal(quote(40000,{specialOrder:true}).reason,'special');
});
test('cantidades inválidas no producen total',()=>{for(const n of [0,-1,NaN,Infinity,29900.5,Number.MAX_SAFE_INTEGER+1])assert.equal(quote(n).reason,'invalid');});
