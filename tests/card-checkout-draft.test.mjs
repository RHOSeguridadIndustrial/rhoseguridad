import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveDeliveryDraft,takeDeliveryDraft} from '../card-checkout-draft.js';
import {address,contact,owner} from './card-database-fixture.mjs';
const input={items:[{sku:'fixture-sku',quantity:2}],address,contact};
function storage(){const map=new Map();return {getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};}
test('authentication return restores only same-owner delivery and consumes the draft',()=>{
 const s=storage();saveDeliveryDraft(s,owner,input,1000);
 assert.equal(takeDeliveryDraft(s,'other',input.items,2000),null);
 assert.deepEqual(takeDeliveryDraft(s,owner,input.items,2000),{paymentMethod:'card',...input});
 assert.equal(takeDeliveryDraft(s,owner,input.items,2000),null);
});
test('changed cart and expired drafts never restore another purchase',()=>{
 const s=storage();saveDeliveryDraft(s,owner,input,1000);
 assert.equal(takeDeliveryDraft(s,owner,[{sku:'other',quantity:2}],2000),null);
 saveDeliveryDraft(s,owner,input,1000);assert.equal(takeDeliveryDraft(s,owner,input.items,1801001),null);
 saveDeliveryDraft(s,owner,input,1000);assert.equal(takeDeliveryDraft(s,owner,input.items,999),null);
});
