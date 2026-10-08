import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../reservation-policy.js',import.meta.url),'utf8');
const {planReservation}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const now=Date.parse('2026-10-08T07:00:00Z');
const stock=(sku,quantity,state='tracked')=>({sku,quantity,state,is_active:true});
const plan=(items,inventory,holds=[])=>planReservation({items,inventory,holds,now});
test('uses exact color and size, without falling back to another SKU',()=>{
  assert.equal(plan([{sku:'casco-blanco',quantity:1}],[stock('casco-amarillo',10)]).action,'quote');
});
test('pending and zero inventory remain quote requests',()=>{
  for(const item of [stock('casco-blanco',0),stock('casco-blanco',0,'pending')])
    assert.equal(plan([{sku:item.sku,quantity:1}],[item]).action,'quote');
});
test('active holds are subtracted, expired and cancelled holds are ignored',()=>{
  const items=[{sku:'casco-blanco',quantity:3}],inventory=[stock('casco-blanco',5)];
  const holds=[{sku:'casco-blanco',quantity:3,status:'active',expiresAt:now+1}];
  assert.equal(plan(items,inventory,holds).action,'quote');
  assert.equal(plan(items,inventory,[{...holds[0],expiresAt:now}]).action,'reserve');
  assert.equal(plan(items,inventory,[{...holds[0],status:'cancelled'}]).action,'reserve');
});
test('duplicate lines are combined and insufficient multi-item requests reserve nothing',()=>{
  assert.equal(plan([{sku:'casco-blanco',quantity:3},{sku:'casco-blanco',quantity:3}],[stock('casco-blanco',5)]).action,'quote');
  const result=plan([{sku:'casco-blanco',quantity:1},{sku:'cono-45cm',quantity:1}],[stock('casco-blanco',5),stock('cono-45cm',0)]);
  assert.equal(result.action,'quote');assert.equal(result.expiresAt,null);
});
test('reservation expires in 30 minutes and invalid quantities are rejected',()=>{
  assert.equal(plan([{sku:'casco-blanco',quantity:1}],[stock('casco-blanco',5)]).expiresAt,now+30*60000);
  for(const quantity of [0,-1,1.5,'1',1000001]) assert.throws(()=>plan([{sku:'casco-blanco',quantity}],[stock('casco-blanco',5)]));
});
