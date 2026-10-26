import test from 'node:test';
import assert from 'node:assert/strict';
import {buildQuoteCatalog, calculateQuote, priceInCents} from '../quote-model.js';
import {searchCatalog} from '../search-catalog.js';
import {inventoryVariants} from '../inventory-catalog.js';

const product = {sku:'n95', name:'N95', unit:'pieza', unitCents:2470, stock:50};
const options = {registered:true, paymentMethod:'card', coverage:'cdmx'};
const quote = (cents, qty=1, settings=options, stock=10000) => calculateQuote([{sku:'n95',quantity:qty}], [{...product,unitCents:cents,stock}], settings);

test('Live prices replace static prices and live names are preserved', () => {
  const rows = buildQuoteCatalog(searchCatalog, inventoryVariants, [{id:'mascarilla-3m-8210-n95',price:'28.45',currency:'MXN',is_active:true}], [{sku:'mascarilla-3m-8210-n95',name:'Nombre corregido',quantity:15,state:'tracked',is_active:true}]);
  assert.equal(rows.length,1); assert.equal(rows[0].unitCents,2845); assert.equal(rows[0].name,'Nombre corregido'); assert.equal(rows[0].stock,15);
});
test('No static fallback for missing, inactive, foreign currency or invalid live prices', () => {
  for (const row of [{},{price:null},{price:0},{price:-1},{price:'not a price'},{price:5,currency:'USD'},{price:5,is_active:false}]) {
    const prices = [{id:'mascarilla-3m-8210-n95',currency:'MXN',is_active:true,...row}];
    assert.equal(buildQuoteCatalog(searchCatalog,inventoryVariants,prices,[]).length,0);
  }
});
test('Exact currency conversion, rejects excessive precision and invalid values', () => {
  assert.equal(priceInCents('64.19'),6419); assert.equal(priceInCents(24.7),2470);
  for (const p of [null,undefined,'',false,NaN,Infinity,-1,1.001]) assert.equal(priceInCents(p),null);
});
test('Variant mapping keeps sizes, excludes generic vest and inactive variants', () => {
  const rows = buildQuoteCatalog(searchCatalog,inventoryVariants,[{id:'chaleco-seguridad',price:64.87,currency:'MXN',is_active:true},{id:'bota-industrial-dielectrica',price:862.50,currency:'MXN',is_active:true}],[{sku:'chaleco-seguridad-naranja',is_active:false}]);
  assert.equal(rows.length,10); assert.equal(rows.some(p=>p.sku==='chaleco-seguridad'),false); assert.equal(rows.some(p=>p.sku==='chaleco-seguridad-naranja'),false); assert.equal(rows.find(p=>p.sku.endsWith('talla-23')).unit,'par');
});
test('VAT is extracted from included price, never added twice', () => {
  const q=quote(2470,3); assert.equal(q.productsCents,7410); assert.equal(q.netCents,6388); assert.equal(q.taxCents,1022); assert.equal(q.netCents+q.taxCents,q.productsCents); assert.equal(q.shipping.totalCents,17310);
});
test('Empty selection and invalid quantities cannot produce a quote', () => {
  assert.throws(()=>calculateQuote([], [product]));
  for (const quantity of [0,-1,1.5,NaN,Infinity,10000,'1',null]) assert.throws(()=>calculateQuote([{sku:'n95',quantity}],[product]));
});
test('Unknown product and stale SKU cannot use a supplied price', () => {
  assert.throws(()=>calculateQuote([{sku:'gone',quantity:1,unitCents:1}],[product]));
});
test('Repeated SKUs are combined before checking shortage', () => {
  const q=calculateQuote([{sku:'n95',quantity:30},{sku:'n95',quantity:30}], [product], options);
  assert.equal(q.lines.length,1); assert.equal(q.lines[0].quantity,60); assert.equal(q.specialOrder,true); assert.equal(q.shipping.totalCents,null);
});
test('Zero stock triggers special order and no promised shipping', () => {
  const q=quote(2470,1,options,0); assert.equal(q.specialOrder,true); assert.equal(q.shipping.reason,'special'); assert.equal(q.shipping.totalCents,null);
});
test('Missing or malformed inventory leaves final total unconfirmed', () => {
  const q=quote(2470,1,options,null); assert.equal(q.stockUnknown,true); assert.equal(q.shipping.reason,'inventory'); assert.equal(q.shipping.shippingCents,null);
});
test('Published shipping boundaries and both payment methods', () => {
  for (const paymentMethod of ['card','transfer']) {
    const o={...options,paymentMethod};
    assert.equal(quote(29899,1,o).shipping.shippingCents,9900);
    assert.equal(quote(29900,1,o).shipping.shippingCents,0);
    assert.equal(quote(120000,1,o).shipping.mode,'standard');
    assert.equal(quote(120001,1,o).shipping.mode,'express');
  }
});
test('Anonymous customer is not promised free shipping above threshold', () => {
  assert.equal(quote(29900,1,{...options,registered:false}).shipping.reason,'registration');
  assert.equal(quote(29899,1,{...options,registered:false}).shipping.shippingCents,9900);
});
test('No total without payment choice or CDMX estimate', () => {
  assert.equal(quote(29900,1,{...options,coverage:'other'}).shipping.totalCents,null);
  assert.equal(quote(29900,1,{...options,paymentMethod:''}).shipping.totalCents,null);
});
test('Large totals and duplicate quantity overflow are rejected', () => {
  assert.throws(()=>quote(Number.MAX_SAFE_INTEGER,2));
  assert.throws(()=>calculateQuote([{sku:'n95',quantity:9999},{sku:'n95',quantity:1}], [product]));
});
