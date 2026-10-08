import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../purchase-channel.js',import.meta.url),'utf8');
const {purchaseChannel}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const stock=(quantity,state='tracked')=>[{sku:'cono-seguridad-45cm',quantity,state,is_active:true}];
const request=quantity=>[{sku:'cono-seguridad-45cm',quantity}];
test('shortage routes a special order, including recorded zero',()=>{
  assert.equal(purchaseChannel(request(1),stock(0,'pending')).action,'special');
  assert.equal(purchaseChannel(request(2),stock(1)).action,'special');
});
test('physical stock does not authorize payment or WhatsApp for normal purchases',()=>{
  assert.equal(purchaseChannel(request(1),stock(1)).action,'onsite_pending');
  assert.equal(purchaseChannel(request(1),stock(1,'pending')).action,'onsite_pending');
});
test('failed, missing and malformed inventory block routing',()=>{
  assert.equal(purchaseChannel(request(1),stock(0),'error').action,'blocked');
  assert.equal(purchaseChannel(request(1),[]).action,'blocked');
  assert.equal(purchaseChannel(request(1),stock(-1)).action,'blocked');
  assert.equal(purchaseChannel(request(0),stock(1)).action,'blocked');
});
test('duplicate SKU quantities are combined before routing',()=>{
  assert.equal(purchaseChannel([...request(1),...request(1)],stock(1)).action,'special');
});
